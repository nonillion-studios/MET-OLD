import { GoogleGenAI, Type } from "@google/genai";
import { Region } from "../types";
import { buildTypesettingPrompt, PageHint } from "./prompt";

// Gemini periodically returns transient errors under load - most commonly HTTP 503
// ("model overloaded") and 429 (rate limited) - that usually succeed on a retry a few
// seconds later. Without this, one blip fails an entire page-processing batch outright
// even though the same request would likely work seconds later.
function isRetryableGeminiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|rate.?limit)\b/i.test(message);
}

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isRetryableGeminiError(err)) throw err;
      // Exponential backoff with jitter: ~1s, 2s, 4s (+/- up to 300ms) before retrying.
      const delay = 2 ** (attempt - 1) * 1000 + Math.random() * 300;
      console.warn(`Gemini request failed (attempt ${attempt}/${maxAttempts}, retrying in ${Math.round(delay)}ms):`, err instanceof Error ? err.message : err);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

export interface RawRegion {
  type: "bubble" | "sfx";
  originalText: string;
  translatedText: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  angle: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  bgColor?: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  lineHeight: number;
}

// Mode 2 of Translation Docs: given the full paragraph list from an uploaded script and
// only the first/last page images (for cover context, character-name grounding, and the
// story's ending), asks the AI to assign every paragraph to a 1-based page number across
// the known page count. Returns -1 for any paragraph the AI can't confidently place.
export async function assignParagraphsToPages(
  paragraphs: string[],
  pageCount: number,
  firstPage: { base64Image: string, mimeType: string },
  lastPage: { base64Image: string, mimeType: string },
  customApiKey?: string
): Promise<number[]> {
  const key = customApiKey;
  if (!key) {
    throw new Error("API Key is required");
  }
  const ai = new GoogleGenAI({ apiKey: key });

  const numberedParagraphs = paragraphs.map((p, i) => `[${i}] ${p}`).join('\n\n');

  const textPrompt = `You are helping paginate a translated manga script. The comic has exactly ${pageCount} pages (page numbers 1 to ${pageCount}). I'm giving you the FIRST page image and the LAST page image only (not the pages in between) for context - use them to recognize the story's opening and ending, character names, and tone.

Below is the full translated script, split into ${paragraphs.length} numbered paragraphs, already in reading order from the first page to the last page:
"""
${numberedParagraphs}
"""

Distribute these paragraphs evenly and logically across the ${pageCount} pages in reading order (paragraph order must stay increasing with page number - never assign a later paragraph an earlier page than an earlier paragraph). Use the first/last page images to anchor paragraph 0 to page 1 and the final paragraph to page ${pageCount}. If a paragraph's page can't be determined confidently, still make your best estimate consistent with the surrounding paragraphs' pages - only use -1 if the paragraph is clearly not part of the story (e.g. a title page or credits note).

Return ONLY a JSON array of ${paragraphs.length} integers (page numbers, 1-based, or -1), one per paragraph, in the exact same order as the numbered paragraphs above.`;

  const response = await callGeminiWithRetry(() => ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { text: textPrompt },
      { inlineData: { data: firstPage.base64Image.split(",")[1] || firstPage.base64Image, mimeType: firstPage.mimeType } },
      { inlineData: { data: lastPage.base64Image.split(",")[1] || lastPage.base64Image, mimeType: lastPage.mimeType } },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER }
      }
    }
  }));

  const text = response.text;
  if (!text) throw new Error("No text returned from Gemini");

  try {
    const pageNumbers = JSON.parse(text) as number[];
    return paragraphs.map((_, i) => {
      const pageNum = pageNumbers[i];
      if (typeof pageNum !== 'number' || pageNum < 1 || pageNum > pageCount) return -1;
      return pageNum - 1; // convert to 0-based image index
    });
  } catch (error) {
    console.error("Failed to parse JSON", text);
    throw new Error("Failed to parse AI response");
  }
}

export async function generateInpaint(base64Image: string, mimeType: string, customApiKey?: string): Promise<string> {
  const key = customApiKey;
  if (!key) {
    throw new Error("API Key is required");
  }
  const ai = new GoogleGenAI({ apiKey: key });

  const response = await callGeminiWithRetry(() => ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType,
          },
        },
        {
          text: 'Remove all text, letters, speech bubbles, and sound effects from this image patch. Seamlessly restore the background underneath without altering the remaining art style or surrounding objects. Output only the cleaned image.',
        },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: '1:1'
      }
    }
  }));

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Failed to generate inpaint image.");
}

export async function processMangaPages(pages: { id: string, base64Image: string, mimeType: string }[], customApiKey?: string, customInstructions?: string, translateJapanese?: boolean, translateSfx?: boolean, generalGuidance?: string, pageHints?: PageHint[], modelName: string = "gemini-2.5-flash"): Promise<{ id: string, regions: RawRegion[] }[]> {
  const key = customApiKey;
  if (!key) {
    throw new Error("API Key is required");
  }
  const ai = new GoogleGenAI({ apiKey: key });

  const textPrompt = buildTypesettingPrompt({
    pageCount: pages.length,
    customInstructions,
    generalGuidance,
    translateJapanese,
    translateSfx,
    pageHints,
  });

  const contents: any[] = [
    {
      text: textPrompt
    }
  ];

  pages.forEach(p => {
    contents.push({
      inlineData: {
        data: p.base64Image.split(",")[1] || p.base64Image,
        mimeType: p.mimeType,
      }
    });
  });

  const response = await callGeminiWithRetry(() => ai.models.generateContent({
    model: modelName,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            pageIndex: { type: Type.INTEGER },
            regions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "either 'bubble' or 'sfx'" },
                  originalText: { type: Type.STRING },
                  translatedText: { type: Type.STRING },
                  ymin: { type: Type.NUMBER, description: "0-1000" },
                  xmin: { type: Type.NUMBER, description: "0-1000" },
                  ymax: { type: Type.NUMBER, description: "0-1000" },
                  xmax: { type: Type.NUMBER, description: "0-1000" },
                  angle: { type: Type.NUMBER, description: "degrees, usually 0 for bubbles" },
                  textColor: { type: Type.STRING, description: "hex color" },
                  strokeColor: { type: Type.STRING, description: "hex color for text outline" },
                  strokeWidth: { type: Type.NUMBER },
                  bgColor: { type: Type.STRING, description: "Hex bg color or transparent" },
                  fontFamily: { type: Type.STRING, description: "Cairo, Tajawal, Marhey, or Aref Ruqaa" },
                  fontSize: { type: Type.NUMBER },
                  fontWeight: { type: Type.STRING },
                  fontStyle: { type: Type.STRING },
                  textAlign: { type: Type.STRING },
                  lineHeight: { type: Type.NUMBER }
                },
                required: ["type", "originalText", "translatedText", "ymin", "xmin", "ymax", "xmax", "angle", "textColor", "strokeColor", "strokeWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "textAlign", "lineHeight"]
              }
            }
          },
          required: ["pageIndex", "regions"]
        }
      }
    }
  }));

  const text = response.text;
  if (!text) throw new Error("No text returned from Gemini");

  try {
    const rawData = JSON.parse(text) as { pageIndex: number, regions: RawRegion[] }[];
    return rawData.map((item, idx) => ({
      id: pages[Math.min(idx, pages.length - 1)].id,
      regions: item.regions || []
    }));
  } catch (error) {
    console.error("Failed to parse JSON", text);
    throw new Error("Failed to parse AI response");
  }
}
