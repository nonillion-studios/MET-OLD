export interface PageHint {
  pageIndex: number;
  hint: string;
}

// Expanded professional-typesetter ruleset, shared by both prompt branches (normal
// detection and Ultra Mode's marker-based re-ask). Gives the AI explicit, text-type-driven
// rules for font/stroke/size/layout instead of leaving it to infer good typesetting
// judgment from a short field list alone.
const TYPESETTING_RULES = `
TEXT TYPE CLASSIFICATION — first decide a "textType" for every region, then let it drive every other typesetting choice below:
  - "dialogue": ordinary calm speech/thought in a normal round/oval bubble.
  - "shout": shouted or intensely emotional speech (ALL CAPS, exclamation-heavy, or drawn large/jagged in the source art).
  - "whisper": quiet/hushed speech, often in a small or dashed-outline bubble.
  - "thought": internal monologue, usually in a cloud-shaped bubble.
  - "narration": caption/narration boxes outside any speech bubble (not a character talking).
  - "sfx": sound effects / onomatopoeia drawn as art rather than dialogue.

FONT CHOICE BY textType:
  - dialogue: "Marhey" by default (medium weight, not overly bold) unless the text clearly demands otherwise.
  - shout: a wider/heavier display font ("Lalezar", "Rakkas", or "Katibeh") — larger than surrounding dialogue in the same scene.
  - whisper: the same family as nearby dialogue but a smaller fontSize and lighter fontWeight.
  - thought: fontStyle "italic", or a font visibly distinct from the page's regular dialogue font.
  - narration: a more formal font ("Cairo", "Almarai", or "Tajawal"), smaller than dialogue, textAlign "center".
  - sfx: a free-form/calligraphic font ("Aref Ruqaa", "Lalezar", or "Katibeh") that matches the direction, shape, and flow of the original SFX art — translate it, don't just transliterate, and angle it to follow the original brushstroke direction.

STROKE (OUTLINE) RULES — vary this per region, never use one fixed stroke everywhere:
  - Dark text inside a plain white/light bubble: no stroke (strokeColor "transparent", strokeWidth 0), or at most a very thin stroke in a barely-contrasting tone.
  - Text placed directly over artwork (narration boxes with no solid fill, SFX, floating captions): strokeWidth roughly 8-12% of the chosen fontSize, in a color that visibly contrasts the artwork behind it at that spot.

SIZING RULES:
  - Derive fontSize from the region's pixel area AND word count together — never return the same fixed number regardless of bubble size.
  - Aim for the rendered text to fill roughly 70-80% of the bubble's inner area with a clear margin from the edges; it must not touch or cross the bubble border.
  - Keep fontSize consistent across bubbles belonging to the same speaker and the same textType on a page - only deviate when "shout"/"whisper" or a genuine size change in the source art justifies it.

LAYOUT:
  - Prefer line breaks that follow the bubble's own shape (wider lines for a round/oval bubble's middle, narrower lines near its top/bottom points; a single narrow column for a tall vertical bubble) rather than arbitrary breaks.
  - Break at natural phrase/word boundaries - never split a word across lines, and avoid leaving a single short word alone on its own line when it can instead join the line before it.
`;

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
    - textType: one of "dialogue", "shout", "whisper", "thought", "narration", "sfx" — see the rules below, it drives every other choice in this list.
    - angle: suggested text rotation in degrees (0 for normal horizontal text; angled for SFX or stylized/dynamic text — you may still rotate any region, including ordinary bubbles, when it suits the art).
    - textColor: hex color code.
    - strokeColor: hex color code for the text outline (critical for SFX or hiding original text).
    - strokeWidth: outline thickness (e.g. 0 to 10).
    - fontFamily: the full allowed list is: "Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Markazi Text", "Reem Kufi", "Rakkas", "Almarai" - pick per textType as described below; when in doubt, use Marhey.
    - fontWeight: 'normal', 'bold', '800', etc.
    - fontStyle: 'normal' or 'italic'.
    - textAlign: 'center', 'right', 'left' (mostly center for bubbles).
    - lineHeight: usually 1.2 to 1.5.
${TYPESETTING_RULES}
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
    - textType: one of "dialogue", "shout", "whisper", "thought", "narration", "sfx" — see the rules below, it drives every other choice in this list.
    - angle: suggested text rotation in degrees (e.g., 0 for normal, angled for SFX).
    - textColor: hex color code.
    - strokeColor: hex color code for the text outline (critical for SFX or hiding original text).
    - strokeWidth: outline thickness (e.g. 0 to 10).
    - fontFamily: the full allowed list is: "Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Markazi Text", "Reem Kufi", "Rakkas", "Almarai" - pick per textType as described below; when in doubt, use Marhey.
    - fontSize: suggest a base size (e.g. 24-72), scaled to the region's area and word count as described below.
    - fontWeight: 'normal', 'bold', '800', etc (bold by def).
    - fontStyle: 'normal' or 'italic'.
    - textAlign: 'center', 'right', 'left' (mostly center for bubbles).
    - lineHeight: usually 1.2 to 1.5.
${TYPESETTING_RULES}
${generalGuidance ? `Additional Instructions from User:\n${generalGuidance}\n` : ""}${customInstructions ? `Additional Instructions from User:\n${customInstructions}\n` : ""}
${pageHints && pageHints.length > 0 ? `Reference translations provided by the user for specific pages (page index → text), use these as the ground-truth translation for that page instead of generating your own:\n${pageHints.map(h => `[page ${h.pageIndex}]: ${h.hint}`).join('\n')}\n` : ""}
Return ONLY a JSON array of objects, one for each page, in the EXACT order they were provided.
Schema: [ { "pageIndex": 0, "regions": [ ... ] } ]`;

  return textPrompt;
}
