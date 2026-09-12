import { GoogleGenAI, Type } from "@google/genai";
import { buildTypesettingPrompt } from "./prompt";
import { AIProvider } from "../types";
import { buildOpenAICompatibleChatRequest, parseOpenAICompatibleResponse } from "./openaiCompatible";
import { fetchOllama } from "./ollama";
import { callGeminiWithRetry } from "./gemini";

// Ultra Mode's simplified per-region translation result: no geometry, just the
// numbered marker index (matching the number drawn on the annotated image) plus
// original/translated text.
export interface UltraNumberedRegionResult {
  region: number;
  originalText: string;
  translatedText: string;
  // The detector only supplies position/size for numbered regions - every other
  // typesetting decision (font, weight, style, color, stroke, rotation, alignment, line
  // height) is the AI's own judgment, for every numbered region, exactly like the normal
  // (non-Ultra) detection mode. All optional since older prompts/parses may omit them.
  angle?: number;
  textColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
  lineHeight?: number;
  // Set (or the "region" number simply omitted) when the AI decides a numbered marker is a
  // likely detector false positive - no real text/dialogue there - instead of inventing text.
  skip?: boolean;
  extra?: false;
}

// AI-detected text NOT covered by any numbered marker (detector miss) - carries its
// own geometry (0-1000 scale, same convention as normal/coordinatesProvided=false mode)
// plus the full set of typesetting fields RawRegion normally provides.
export interface UltraExtraRegionResult {
  extra: true;
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
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  lineHeight: number;
}

export type UltraRegionResult = UltraNumberedRegionResult | UltraExtraRegionResult;

interface UltraTranslateOptions {
  provider: AIProvider;
  base64Image: string; // annotated image with numbered markers, data URL or raw base64
  mimeType: string;
  customApiKey?: string;
  geminiModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  openaiCompatBaseUrl?: string;
  openaiCompatApiKey?: string;
  openaiCompatModel?: string;
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
IMPORTANT: Respond with ONLY a raw JSON array (no markdown, no code fences, no commentary) matching EXACTLY this shape - each entry is EITHER a numbered-marker entry OR an "extra" (detector-missed) entry:
[
  { "region": number, "originalText": string, "translatedText": string, "skip": boolean (optional, true if this marker is not real text), "angle": number, "textColor": string, "strokeColor": string, "strokeWidth": number, "fontFamily": string, "fontWeight": string, "fontStyle": string, "textAlign": string, "lineHeight": number },
  { "extra": true, "originalText": string, "translatedText": string, "ymin": number, "xmin": number, "ymax": number, "xmax": number, "angle": number, "textColor": string, "strokeColor": string, "strokeWidth": number, "fontFamily": string, "fontSize": number, "fontWeight": string, "fontStyle": string, "textAlign": string, "lineHeight": number }
]`;

    const response = await fetchOllama(`${opts.ollamaEndpoint.replace(/\/$/, "")}/api/generate`, {
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

  if (opts.provider === 'openai_compatible') {
    if (!opts.openaiCompatBaseUrl) throw new Error("Base URL is required");
    if (!opts.openaiCompatApiKey) throw new Error("API key is required");
    if (!opts.openaiCompatModel) throw new Error("Model name is required");

    const schemaInstructions = `
IMPORTANT: Respond with ONLY a raw JSON array (no markdown, no code fences, no commentary) matching EXACTLY this shape - each entry is EITHER a numbered-marker entry OR an "extra" (detector-missed) entry:
[
  { "region": number, "originalText": string, "translatedText": string, "fontFamily": string (optional, sfx regions only) },
  { "extra": true, "originalText": string, "translatedText": string, "ymin": number, "xmin": number, "ymax": number, "xmax": number, "angle": number, "textColor": string, "strokeColor": string, "strokeWidth": number, "fontFamily": string, "fontSize": number, "fontWeight": string, "fontStyle": string, "textAlign": string, "lineHeight": number }
]`;

    const request = buildOpenAICompatibleChatRequest(
      opts.openaiCompatBaseUrl,
      opts.openaiCompatApiKey,
      opts.openaiCompatModel,
      prompt + schemaInstructions,
      rawBase64,
      opts.mimeType
    );

    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Ultra Mode: OpenAI-compatible request failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    try {
      return parseOpenAICompatibleResponse(data) as unknown as UltraRegionResult[];
    } catch (error) {
      console.error("Ultra Mode: failed to parse OpenAI-compatible JSON response", data);
      throw new Error("Ultra Mode: failed to parse AI response from OpenAI-compatible endpoint");
    }
  }

  // Gemini
  if (!opts.customApiKey) throw new Error("API Key is required");
  const ai = new GoogleGenAI({ apiKey: opts.customApiKey });

  const response = await callGeminiWithRetry(() => ai.models.generateContent({
    model: opts.geminiModel || "gemini-2.5-flash",
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
                  // Numbered-marker entries (primary path)
                  region: { type: Type.INTEGER },
                  originalText: { type: Type.STRING },
                  translatedText: { type: Type.STRING },
                  skip: { type: Type.BOOLEAN },
                  fontFamily: { type: Type.STRING },
                  // "extra" (detector-missed) entries: geometry + typesetting fields.
                  // All optional here since Gemini's structured schema doesn't support
                  // true unions - they're simply absent/null on numbered entries.
                  extra: { type: Type.BOOLEAN },
                  ymin: { type: Type.NUMBER },
                  xmin: { type: Type.NUMBER },
                  ymax: { type: Type.NUMBER },
                  xmax: { type: Type.NUMBER },
                  angle: { type: Type.NUMBER },
                  textColor: { type: Type.STRING },
                  strokeColor: { type: Type.STRING },
                  strokeWidth: { type: Type.NUMBER },
                  fontSize: { type: Type.NUMBER },
                  fontWeight: { type: Type.STRING },
                  fontStyle: { type: Type.STRING },
                  textAlign: { type: Type.STRING },
                  lineHeight: { type: Type.NUMBER },
                },
                required: ["originalText", "translatedText"],
              },
            },
          },
          required: ["pageIndex", "regions"],
        },
      },
    },
  }));

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
