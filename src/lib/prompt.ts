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
  // Ultra Mode: when true, the page already has numbered region markers drawn on it
  // (from a YOLO detector pass) so the AI should NOT be asked for geometry at all —
  // just per-numbered-region text extraction/translation.
  coordinatesProvided?: boolean;
}

export function buildTypesettingPrompt({
  pageCount,
  customInstructions,
  generalGuidance,
  translateJapanese,
  translateSfx,
  pageHints,
  coordinatesProvided,
}: BuildTypesettingPromptOptions): string {
  if (coordinatesProvided) {
    let ultraPrompt = `You are an expert manga translator. I am providing ${pageCount} manga page(s).
Each page already has numbered region markers (small numbered boxes) drawn directly on the image, one per speech bubble/text/SFX region that has already been detected. Do NOT detect regions yourself and do NOT return any coordinates or bounding boxes — the geometry is already known.

For EACH numbered marker visible on the page:
1. Identify the original text inside/near that numbered region.
2. ${translateJapanese ? "Translate it accurately and naturally to Arabic. Prioritize smooth, colloquial or literary flow depending on context." : "Extract the text and keep the 'translatedText' field as the original text (do NOT translate)."}
${!translateSfx ? "3. IGNORE any numbered region that is purely a sound effect (SFX) with no dialogue — do not include it in the output.\n" : ""}
4. For a numbered region that is a sound effect (SFX) drawn as stylized art (not a normal speech/thought bubble), you MAY optionally suggest a stylistic "fontFamily" for it, chosen exactly from: "Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Markazi Text", "Reem Kufi", "Rakkas", "Almarai" (favor bold/expressive faces like Aref Ruqaa, Lalezar, Rakkas, Katibeh for SFX). Do NOT include a "fontFamily" for normal speech/thought bubble or narration regions — those always render in Marhey regardless of what you provide, so omit the field for them.
${generalGuidance ? `Additional Instructions from User:\n${generalGuidance}\n` : ""}${customInstructions ? `Additional Instructions from User:\n${customInstructions}\n` : ""}
${pageHints && pageHints.length > 0 ? `Reference translations provided by the user for specific pages (page index → text), use these as the ground-truth translation for that page instead of generating your own:\n${pageHints.map(h => `[page ${h.pageIndex}]: ${h.hint}`).join('\n')}\n` : ""}
Return ONLY a JSON array of objects, one for each page, in the EXACT order they were provided.
Schema: [ { "pageIndex": 0, "regions": [ { "region": 1, "originalText": "...", "translatedText": "...", "fontFamily": "..." (optional, SFX regions only) } ] } ]
The "region" field MUST match the number printed on the marker in the image. Do not invent numbers that aren't present on the page, and do not include geometry/coordinates of any kind.`;

    return ultraPrompt;
  }

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
    - fontFamily: choose exactly from: "Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Markazi Text", "Reem Kufi", "Rakkas", "Almarai". (e.g. Marhey/Katibeh/Changa/Lemonada for informal conversation bubbles, Aref Ruqaa/Lalezar/Rakkas for SFX or angry shouts, Cairo/Almarai/Tajawal for formal narration or thoughts). VARY THE FONTS ACROSS DIFFERENT BUBBLES DEPENDING ON THE TONE AND CONTEXT.(marahy by def for bubbles only (try to make fonts units))
    - fontSize: suggest a base size (e.g. 24-72).
    - fontWeight: 'normal', 'bold', '800', etc (bold by def).
    - fontStyle: 'normal' or 'italic'.
    - textAlign: 'center', 'right', 'left' (mostly center for bubbles).
    - lineHeight: usually 1.2 to 1.5.

${generalGuidance ? `Additional Instructions from User:\n${generalGuidance}\n` : ""}${customInstructions ? `Additional Instructions from User:\n${customInstructions}\n` : ""}
${pageHints && pageHints.length > 0 ? `Reference translations provided by the user for specific pages (page index → text), use these as the ground-truth translation for that page instead of generating your own:\n${pageHints.map(h => `[page ${h.pageIndex}]: ${h.hint}`).join('\n')}\n` : ""}
Return ONLY a JSON array of objects, one for each page, in the EXACT order they were provided.
Schema: [ { "pageIndex": 0, "regions": [ ... ] } ]`;

  return textPrompt;
}
