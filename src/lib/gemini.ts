import { GoogleGenAI, Type } from "@google/genai";
import { Region } from "../types";
import { buildTypesettingPrompt, PageHint } from "./prompt";

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

export async function generateInpaint(base64Image: string, mimeType: string, customApiKey?: string): Promise<string> {
  const key = customApiKey;
  if (!key) {
    throw new Error("API Key is required");
  }
  const ai = new GoogleGenAI({ apiKey: key });

  const response = await ai.models.generateContent({
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
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Failed to generate inpaint image.");
}

export async function processMangaPages(pages: { id: string, base64Image: string, mimeType: string }[], customApiKey?: string, customInstructions?: string, translateJapanese?: boolean, translateSfx?: boolean, generalGuidance?: string, pageHints?: PageHint[]): Promise<{ id: string, regions: RawRegion[] }[]> {
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

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
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
  });

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
