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
    let ultraPrompt = `You are an expert manga translator and professional typesetter. I am providing ${pageCount} manga page(s).
Each page already has numbered region markers (small numbered boxes) drawn directly on the image, one per speech bubble/text/SFX region that has already been detected. Do NOT detect regions yourself and do NOT return any coordinates or bounding boxes for numbered markers — the detector already supplies the POSITION and SIZE for each one. You are only being asked for the TEXT and every other typesetting decision (font, weight, style, color, stroke, rotation, alignment, line height) — exactly the same decisions you'd make in normal (non-marker) detection mode.

For EACH numbered marker visible on the page:
1. Identify the original text inside/near that numbered region.
2. ${translateJapanese ? "Translate it accurately and naturally to Arabic. Prioritize smooth, colloquial or literary flow depending on context." : "Extract the text and keep the 'translatedText' field as the original text (do NOT translate)."}
3. If the numbered marker clearly does NOT contain real text/dialogue — empty space, pure art with no text, a duplicate marker sitting on text already covered by another marker, or any other detector false positive — set "skip": true for that entry (or simply omit that region number entirely) instead of inventing or guessing text that isn't there.
${!translateSfx ? "4. IGNORE any numbered region that is purely a sound effect (SFX) with no dialogue — do not include it in the output.\n" : ""}
5. For EVERY numbered marker you don't skip (not just SFX), also decide the full typesetting presentation, exactly as in normal detection mode — the marker only tells you WHERE and roughly HOW BIG the region is, not how it should look:
    - angle: suggested text rotation in degrees (0 for normal horizontal text; angled for SFX or stylized/dynamic text — you may still rotate any region, including ordinary bubbles, when it suits the art).
    - textColor: hex color code.
    - strokeColor: hex color code for the text outline (critical for SFX or hiding original text).
    - strokeWidth: outline thickness (e.g. 0 to 10).
    - fontFamily: choose exactly from: "Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Markazi Text", "Reem Kufi", "Rakkas", "Almarai" (e.g. Marhey/Katibeh/Changa/Lemonada for informal conversation bubbles, Aref Ruqaa/Lalezar/Rakkas/Katibeh for SFX or angry shouts, Cairo/Almarai/Tajawal for formal narration or thoughts). VARY THE FONTS ACROSS DIFFERENT REGIONS DEPENDING ON THE TONE AND CONTEXT.
    - fontWeight: 'normal', 'bold', '800', etc.
    - fontStyle: 'normal' or 'italic'.
    - textAlign: 'center', 'right', 'left' (mostly center for bubbles).
    - lineHeight: usually 1.2 to 1.5.
${generalGuidance ? `Additional Instructions from User:\n${generalGuidance}\n` : ""}${customInstructions ? `Additional Instructions from User:\n${customInstructions}\n` : ""}
${pageHints && pageHints.length > 0 ? `Reference translations provided by the user for specific pages (page index → text), use these as the ground-truth translation for that page instead of generating your own:\n${pageHints.map(h => `[page ${h.pageIndex}]: ${h.hint}`).join('\n')}\n` : ""}
6. If you notice any additional speech bubble, narration, or SFX text that is NOT covered by any numbered marker (i.e. the detector missed it), include it as a separate entry with "extra": true instead of a "region" number, along with its own bounding box coordinates [ymin, xmin, ymax, xmax] scaled to 0-1000 (same convention as normal detection), plus the same typesetting fields listed above, and also:
    - fontSize: suggest a base size (e.g. 24-72).
Only use "extra" entries for text that is genuinely missing a numbered marker - do not duplicate anything already covered by a numbered marker.
Return ONLY a JSON array of objects, one for each page, in the EXACT order they were provided.
Schema: [ { "pageIndex": 0, "regions": [ { "region": 1, "originalText": "...", "translatedText": "...", "skip": false, "angle": 0, "textColor": "#000000", "strokeColor": "transparent", "strokeWidth": 0, "fontFamily": "Marhey", "fontWeight": "normal", "fontStyle": "normal", "textAlign": "center", "lineHeight": 1.2 } ] } ]
The "region" field MUST match the number printed on the marker in the image. Do not invent numbers that aren't present on the page, and do not include geometry/coordinates of any kind for numbered entries. Entries reporting missed text use "extra": true and DO include geometry, as described above.`;

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
