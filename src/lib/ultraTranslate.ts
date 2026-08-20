import { GoogleGenAI, Type } from "@google/genai";
import { buildTypesettingPrompt } from "./prompt";
import { AIProvider } from "../types";

// Ultra Mode's simplified per-region translation result: no geometry, just the
// numbered marker index (matching the number drawn on the annotated image) plus
// original/translated text.
export interface UltraRegionResult {
  region: number;
  originalText: string;
  translatedText: string;
}

interface UltraTranslateOptions {
  provider: AIProvider;
  base64Image: string; // annotated image with numbered markers, data URL or raw base64
  mimeType: string;
  customApiKey?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  customInstructions?: string;
  generalGuidance?: string;
  translateJapanese?: boolean;
  translateSfx?: boolean;
}

export async function translateUltraModePage(opts: UltraTranslateOptions): Promise<UltraRegionResult[]> {
  const prompt = buildTypesettingPrompt({
    pageCount: 1,
    customInstructions: opts.customInstructions,
    generalGuidance: opts.generalGuidance,
    translateJapanese: opts.translateJapanese,
    translateSfx: opts.translateSfx,
    coordinatesProvided: true,
  });

  const rawBase64 = opts.base64Image.includes(',') ? opts.base64Image.split(',')[1] : opts.base64Image;

  if (opts.provider === 'ollama') {
    if (!opts.ollamaEndpoint) throw new Error("Ollama endpoint is required");
    if (!opts.ollamaModel) throw new Error("Ollama model name is required");

    const schemaInstructions = `
IMPORTANT: Respond with ONLY a raw JSON array (no markdown, no code fences, no commentary) matching EXACTLY this shape:
[ { "region": number, "originalText": string, "translatedText": string } ]`;

    const response = await fetch(`${opts.ollamaEndpoint.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.ollamaModel,
        prompt: prompt + schemaInstructions,
        images: [rawBase64],
        format: "json",
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Ultra Mode: Ollama request failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    const text: string | undefined = data?.response;
    if (!text) throw new Error("Ultra Mode: no response text returned from Ollama");

    try {
      const jsonStart = text.indexOf('[');
      const jsonEnd = text.lastIndexOf(']');
      const jsonText = jsonStart !== -1 && jsonEnd !== -1 ? text.substring(jsonStart, jsonEnd + 1) : text;
      const parsed = JSON.parse(jsonText);
      const arr = Array.isArray(parsed) ? parsed : (parsed?.regions || []);
      return arr as UltraRegionResult[];
    } catch (error) {
      console.error("Ultra Mode: failed to parse Ollama JSON response", text);
      throw new Error("Ultra Mode: failed to parse AI response from Ollama");
    }
  }

  // Gemini
  if (!opts.customApiKey) throw new Error("API Key is required");
  const ai = new GoogleGenAI({ apiKey: opts.customApiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { text: prompt },
      { inlineData: { data: rawBase64, mimeType: opts.mimeType } },
    ],
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
                  region: { type: Type.INTEGER },
                  originalText: { type: Type.STRING },
                  translatedText: { type: Type.STRING },
                },
                required: ["region", "originalText", "translatedText"],
              },
            },
          },
          required: ["pageIndex", "regions"],
        },
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("Ultra Mode: no text returned from Gemini");

  try {
    const rawData = JSON.parse(text) as { pageIndex: number, regions: UltraRegionResult[] }[];
    return rawData[0]?.regions || [];
  } catch (error) {
    console.error("Ultra Mode: failed to parse JSON", text);
    throw new Error("Ultra Mode: failed to parse AI response");
  }
}
