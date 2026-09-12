import { RawRegion } from "./gemini";
import { buildTypesettingPrompt, PageHint } from "./prompt";

// Generalized provider for any endpoint speaking the OpenAI Chat Completions API
// shape (POST {baseUrl}/chat/completions, Bearer auth, vision via image_url content
// parts). This single provider covers Ollama Cloud (https://ollama.com/v1), OpenRouter
// (https://openrouter.ai/api/v1), Groq (https://api.groq.com/openai/v1), Together AI
// (https://api.together.xyz/v1), DeepSeek (https://api.deepseek.com/v1), xAI/Grok
// (https://api.x.ai/v1), and any other OpenAI-compatible host, without needing a
// dedicated integration per provider.
//
// Like ollama.ts, this does NOT rely on native structured-output/tool-calling schemas
// (support for those varies a lot across third-party OpenAI-compatible hosts) - instead
// it appends a JSON-schema description to the prompt text and parses the JSON array out
// of the model's plain-text reply, exactly like the Ollama integration does.

const SCHEMA_INSTRUCTIONS = `
IMPORTANT: Respond with ONLY a raw JSON array (no markdown, no code fences, no commentary) of region objects for THIS single page, matching EXACTLY this shape for each item:
{
  "type": "bubble" | "sfx",
  "originalText": string,
  "translatedText": string,
  "ymin": number, "xmin": number, "ymax": number, "xmax": number,
  "angle": number,
  "textColor": string,
  "strokeColor": string,
  "strokeWidth": number,
  "bgColor": string,
  "fontFamily": string,
  "fontSize": number,
  "fontWeight": string,
  "fontStyle": string,
  "textAlign": string,
  "lineHeight": number
}
Return: [ { ... }, { ... } ]`;

export interface OpenAICompatibleChatRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: {
      role: "user";
      content: (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
    }[];
    stream: false;
  };
}

// Pure, testable request-shape builder - no network I/O. Kept separate from the fetch
// call so the request construction (URL, headers, image encoding, prompt content) can
// be asserted in tests without mocking fetch.
export function buildOpenAICompatibleChatRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  base64Image: string,
  mimeType: string
): OpenAICompatibleChatRequest {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const rawBase64 = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
  const dataUrl = `data:${mimeType};base64,${rawBase64}`;

  return {
    url: `${normalizedBase}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      stream: false,
    },
  };
}

// Parses an OpenAI-shaped chat completion response (choices[0].message.content is a
// string, possibly with markdown fences or commentary around the JSON array) into
// RawRegion[], mirroring ollama.ts's parsing of its plain-text response.
export function parseOpenAICompatibleResponse(data: any): RawRegion[] {
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("No response text returned from OpenAI-compatible endpoint");
  }

  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  const jsonText = jsonStart !== -1 && jsonEnd !== -1 ? text.substring(jsonStart, jsonEnd + 1) : text;
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed) ? parsed : (parsed?.regions || []);
}

export async function processMangaPagesOpenAICompatible(
  pages: { id: string, base64Image: string, mimeType: string }[],
  baseUrl: string,
  apiKey: string,
  model: string,
  customInstructions?: string,
  generalGuidance?: string,
  translateJapanese?: boolean,
  translateSfx?: boolean,
  pageHints?: PageHint[]
): Promise<{ id: string, regions: RawRegion[] }[]> {
  if (!baseUrl) {
    throw new Error("Base URL is required");
  }
  if (!apiKey) {
    throw new Error("API key is required");
  }
  if (!model) {
    throw new Error("Model name is required");
  }

  const results: { id: string, regions: RawRegion[] }[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    const hintForPage = pageHints?.find(h => h.pageIndex === i);
    const basePrompt = buildTypesettingPrompt({
      pageCount: 1,
      customInstructions,
      generalGuidance,
      translateJapanese,
      translateSfx,
      pageHints: hintForPage ? [{ pageIndex: 0, hint: hintForPage.hint }] : undefined,
    });

    const request = buildOpenAICompatibleChatRequest(
      baseUrl,
      apiKey,
      model,
      basePrompt + SCHEMA_INSTRUCTIONS,
      page.base64Image,
      page.mimeType
    );

    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenAI-compatible request failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();

    let regions: RawRegion[];
    try {
      regions = parseOpenAICompatibleResponse(data);
    } catch (error) {
      console.error("Failed to parse OpenAI-compatible JSON response", data);
      throw new Error("Failed to parse AI response from OpenAI-compatible endpoint");
    }

    results.push({ id: page.id, regions });
  }

  return results;
}
