export interface PageHint {
  pageIndex: number;
  hint: string;
}

export interface BuildTypesettingPromptOptions {
  pageCount: number;
  customInstructions?: string;
  generalGuidance?: string;
  translateJapanese?: boolean;
  translateSfx?: boolean;
  pageHints?: PageHint[];
}

export function buildTypesettingPrompt({
  pageCount,
  customInstructions,
  generalGuidance,
  translateJapanese,
  translateSfx,
  pageHints,
}: BuildTypesettingPromptOptions): string {
  let textPrompt = `You are an expert manga translator and professional typesetter.
I am providing ${pageCount} manga page(s). Analyze EACH page independently.
For each page, detect all speech bubbles, narrative text, and sound effects (SFX).

1. Identify the original text.
2. ${translateJapanese ? "Translate it accurately and naturally to Arabic. Prioritize smooth, colloquial or literary flow depending on context." : "Extract the text and keep the 'translatedText' field as the original text (do NOT translate)."}
3. Determine the bounding box coordinates [ymin, xmin, ymax, xmax] scaled to 0-1000.
4. Categorize as 'bubble' (for standard conversation/speech bubbles and thought bubbles) or 'sfx' (for sound effects, ambient noises drawn as art, floating text outside bubbles). Be very strict about this distinction! SFX should only be text that represents sound. ${!translateSfx ? "\nIGNORE ALL 'sfx' (sound effects) COMPLETELY. Do not add them to the regions array." : ""}
5. typesetter decisions:
    - angle: suggested text rotation in degrees (e.g., 0 for normal, angled for SFX).
    - textColor: hex color code.
    - strokeColor: hex color code for the text outline (critical for SFX or hiding original text).
    - strokeWidth: outline thickness (e.g. 0 to 10).
    - fontFamily: choose exactly from: "Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Markazi Text", "Reem Kufi", "Rakkas", "Almarai". (e.g. Marhey/Katibeh/Changa/Lemonada for informal conversation bubbles, Aref Ruqaa/Lalezar/Rakkas for SFX or angry shouts, Cairo/Almarai/Tajawal for formal narration or thoughts). VARY THE FONTS ACROSS DIFFERENT BUBBLES DEPENDING ON THE TONE AND CONTEXT.
    - fontSize: suggest a base size (e.g. 24-72).
    - fontWeight: 'normal', 'bold', '800', etc.
    - fontStyle: 'normal' or 'italic'.
    - textAlign: 'center', 'right', 'left' (mostly center for bubbles).
    - lineHeight: usually 1.2 to 1.5.

${generalGuidance ? `Additional Instructions from User:\n${generalGuidance}\n` : ""}${customInstructions ? `Additional Instructions from User:\n${customInstructions}\n` : ""}
${pageHints && pageHints.length > 0 ? `Reference translations provided by the user for specific pages (page index → text), use these as the ground-truth translation for that page instead of generating your own:\n${pageHints.map(h => `[page ${h.pageIndex}]: ${h.hint}`).join('\n')}\n` : ""}
Return ONLY a JSON array of objects, one for each page, in the EXACT order they were provided.
Schema: [ { "pageIndex": 0, "regions": [ ... ] } ]`;

  return textPrompt;
}
