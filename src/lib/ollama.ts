import { RawRegion } from "./gemini";
import { buildTypesettingPrompt, PageHint } from "./prompt";

export async function processMangaPagesOllama(
  pages: { id: string, base64Image: string, mimeType: string }[],
  endpoint: string,
  model: string,
  customInstructions?: string,
  generalGuidance?: string,
  translateJapanese?: boolean,
  translateSfx?: boolean,
  pageHints?: PageHint[]
): Promise<{ id: string, regions: RawRegion[] }[]> {
  if (!endpoint) {
    throw new Error("Ollama endpoint is required");
  }
  if (!model) {
    throw new Error("Ollama model name is required");
  }

  const schemaInstructions = `
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

  const results: { id: string, regions: RawRegion[] }[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const base64 = page.base64Image.split(",")[1] || page.base64Image;

    const hintForPage = pageHints?.find(h => h.pageIndex === i);
    const basePrompt = buildTypesettingPrompt({
      pageCount: 1,
      customInstructions,
      generalGuidance,
      translateJapanese,
      translateSfx,
      pageHints: hintForPage ? [{ pageIndex: 0, hint: hintForPage.hint }] : undefined,
    });

    const response = await fetch(`${endpoint.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: basePrompt + schemaInstructions,
        images: [base64],
        format: "json",
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    const text: string | undefined = data?.response;
    if (!text) {
      throw new Error("No response text returned from Ollama");
    }

    let regions: RawRegion[];
    try {
      const jsonStart = text.indexOf('[');
      const jsonEnd = text.lastIndexOf(']');
      const jsonText = jsonStart !== -1 && jsonEnd !== -1 ? text.substring(jsonStart, jsonEnd + 1) : text;
      const parsed = JSON.parse(jsonText);
      regions = Array.isArray(parsed) ? parsed : (parsed?.regions || []);
    } catch (error) {
      console.error("Failed to parse Ollama JSON response", text);
      throw new Error("Failed to parse AI response from Ollama");
    }

    results.push({ id: page.id, regions });
  }

  return results;
}
