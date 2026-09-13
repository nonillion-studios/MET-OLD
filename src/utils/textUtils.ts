import Konva from 'konva';

export function clampRegionToImage(
  x: number,
  y: number,
  width: number,
  height: number,
  imgWidth: number,
  imgHeight: number
): { x: number; y: number; width: number; height: number } {
  let cx = Math.min(Math.max(x, 0), imgWidth);
  let cy = Math.min(Math.max(y, 0), imgHeight);
  let cw = Math.max(0, Math.min(width, imgWidth - cx));
  let ch = Math.max(0, Math.min(height, imgHeight - cy));
  return { x: cx, y: cy, width: cw, height: ch };
}

export function mapRawRegionToPixels(
  raw: { xmin: number; ymin: number; xmax: number; ymax: number },
  imgWidth: number,
  imgHeight: number
): { x: number; y: number; width: number; height: number } {
  const x = (raw.xmin / 1000) * imgWidth;
  const y = (raw.ymin / 1000) * imgHeight;
  const width = ((raw.xmax - raw.xmin) / 1000) * imgWidth;
  const height = ((raw.ymax - raw.ymin) / 1000) * imgHeight;
  return clampRegionToImage(x, y, width, height, imgWidth, imgHeight);
}

// Historically wrapped each line in U+2067 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL
// ISOLATE to force RTL direction for Konva's canvas text rendering. Empirically disproven:
// reported bug was neutral punctuation (ellipsis, ؟, !) at the START of a line rendering on
// the wrong (left) visual side. Reproduced and measured directly (render to a real canvas,
// locate glyphs by template-matching their ink profile against known x-ranges):
//   - WITH the FSI/PDI wrapping: a leading "..." in "...يا ترى كم تعلمت" renders at the
//     LEFT edge - wrong, should be rightmost since it's logically first in RTL text.
//   - WITHOUT any wrapping (raw text): the same string renders "..." correctly at the
//     RIGHT edge. Chrome's canvas text rendering already runs the Unicode Bidi Algorithm
//     for Arabic-containing strings with no help needed - the isolate marks were actively
//     fighting it for leading neutrals, not helping it.
// Also verified plain Arabic (no marks) still shapes/joins correctly (multi-word sentences,
// digit-leading text like "3 أيام مرت", and multi-letter joined words like "المعروفة" all
// render correctly without the wrapper), and that Konva's own multi-line word-wrap - which
// only ever saw the isolate marks at the true start/end of the whole string, never around
// each individually-wrapped visual line - was part of why interior wrapped lines behaved
// inconsistently from the first/last line. A no-op avoids that entirely.
// Kept as a named pass-through (not deleted / inlined at call sites) so a future bidi
// regression is easy to trace back to this decision and its reasoning.
export function wrapRtlLines(text: string): string {
  return text;
}

// Reference size for comparing words' rendered widths - large enough that per-glyph
// rounding differences between words don't flip which one is actually widest, and since
// all words in the same font scale together, the widest-at-this-size word stays the
// widest at whatever font size the caller actually renders at.
const WORD_WIDTH_COMPARISON_FONT_SIZE = 100;

function findWidestWord(words: string[], fontFamily: string, fontStyle: string, letterSpacing: number): string {
  if (words.length === 0) return '';
  const measureNode = new Konva.Text({ fontFamily, fontStyle, letterSpacing, fontSize: WORD_WIDTH_COMPARISON_FONT_SIZE });
  let widest = words[0];
  let widestWidth = -1;
  for (const word of words) {
    measureNode.text(word);
    const w = measureNode.width();
    if (w > widestWidth) {
      widestWidth = w;
      widest = word;
    }
  }
  measureNode.destroy();
  return widest;
}

export function calculateAutoFitFontSize(
  text: string,
  width: number,
  height: number,
  fontFamily: string,
  fontStyle: string,
  lineHeight: number,
  letterSpacing: number,
  defaultFontSize: number
): number {
  if (!text) return defaultFontSize;

  // Cap growth at roughly the AI's own suggested fontSize (which it derives from the
  // original lettering's scale on the page) plus a little slack for a translation that
  // happens to be shorter than the source text - not a flat 100px ceiling. Without this,
  // a spacious/oversized box lets the binary search below grow translated text far larger
  // than the artist's original lettering ever was, which reads as jarring even when it
  // technically "fits" the box. Mirrors the "cap font size to source text height"
  // technique other manga-translation tools use, adapted to what's available here (no
  // separate OCR glyph-height measurement, so the AI's own size suggestion is the proxy).
  let minFontSize = 8;
  let maxFontSize = Math.max(minFontSize, Math.min(100, Math.round(defaultFontSize * 1.15)));
  let bestFontSize = defaultFontSize;

  // Find the word that's actually WIDEST when rendered, not just the one with the most
  // characters - character count is a poor proxy for pixel width in Arabic, where letter
  // widths vary a lot (compare a word full of ه/م/ع to one full of ا/ل/ي at the same
  // length) and joining/ligature shapes shift width further. Picking by length could miss
  // the real widest word entirely, under-measuring how much room is actually needed and
  // letting Konva's word-wrap fall back to breaking mid-word when that word turns out not
  // to fit after all (its own overflow fallback - "word" wrap still splits a single word
  // that doesn't fit alone, it doesn't just let it overflow).
  const words = text.split(/\s+/).filter(Boolean);
  const longestWord = findWidestWord(words, fontFamily, fontStyle, letterSpacing);

  const measureNode = new Konva.Text({
    text: longestWord,
    fontFamily: fontFamily,
    fontStyle: fontStyle,
    letterSpacing: letterSpacing,
  });

  const testNode = new Konva.Text({
    text: wrapRtlLines(text),
    width: width,
    fontFamily: fontFamily,
    fontStyle: fontStyle,
    lineHeight: lineHeight,
    letterSpacing: letterSpacing,
    wrap: 'word'
  });

  // Give 8% height buffer and 4% width buffer to handle speech bubble curvaceous edges without scaling down to tiny texts
  const heightLimit = height * 1.08;
  const widthLimit = width * 1.04;

  while (minFontSize <= maxFontSize) {
    const mid = Math.floor((minFontSize + maxFontSize) / 2);
    
    testNode.fontSize(mid);
    const textHeight = testNode.height();

    measureNode.fontSize(mid);
    const longestWordWidth = measureNode.width();

    if (textHeight > heightLimit || longestWordWidth > (widthLimit - 4)) {
      maxFontSize = mid - 1;
    } else {
      bestFontSize = mid;
      minFontSize = mid + 1;
    }
  }

  measureNode.destroy();
  testNode.destroy();

  return Math.max(9, bestFontSize); // Absolute minimum 9px to prevent unreadable microscopic fonts
}

// Measures the actual wrapped height that `text` requires at `fontSize` within `width`,
// using the same RTL-wrapped measurement approach as calculateAutoFitFontSize. Callers use
// this to detect when a text box would clip its content and needs to grow.
export function measureWrappedTextHeight(
  text: string,
  width: number,
  fontFamily: string,
  fontStyle: string,
  lineHeight: number,
  letterSpacing: number,
  fontSize: number
): number {
  if (!text) return 0;

  const node = new Konva.Text({
    text: wrapRtlLines(text),
    width: width,
    fontFamily: fontFamily,
    fontStyle: fontStyle,
    lineHeight: lineHeight,
    letterSpacing: letterSpacing,
    fontSize: fontSize,
    wrap: 'word'
  });

  const height = node.height();
  node.destroy();
  return height;
}

export interface AutoFitBox {
  renderWidth: number;
  renderHeight: number;
  xOffset: number;
  yOffset: number;
}

// Grows a region's rendered box beyond its detected bounds, symmetrically around its
// center and clamped to the page, whenever text would otherwise be clipped.
//
// calculateAutoFitFontSize has an absolute floor (9px) it will accept even when the
// longest word STILL doesn't fit the region's width at that size - and since Konva's
// wrap:'word' never breaks a word mid-glyph, that word just overflows sideways past the
// region instead of wrapping. On a narrow bubble (e.g. a flood-filled balloon that came
// out taller than it is wide) that overflow lands past the bubble's visible fill, on the
// artwork behind it - the text isn't gone, it's rendered somewhere invisible. This widens
// the box first so the wrap actually has room, THEN re-measures the height growth the
// three render paths (studio canvas, ZIP/PDF export, PSD export) already each did
// separately - centralized here so all three stay in sync.
export function calculateAutoFitBox(
  text: string,
  regionX: number,
  regionY: number,
  regionWidth: number,
  regionHeight: number,
  fontFamily: string,
  fontStyle: string,
  lineHeight: number,
  letterSpacing: number,
  fontSize: number,
  pageWidth: number,
  pageHeight: number
): AutoFitBox {
  if (!text) return { renderWidth: regionWidth, renderHeight: regionHeight, xOffset: 0, yOffset: 0 };

  const words = text.split(/\s+/).filter(Boolean);
  const longestWord = findWidestWord(words, fontFamily, fontStyle, letterSpacing);
  const measureNode = new Konva.Text({ text: longestWord, fontFamily, fontStyle, fontSize, letterSpacing });
  const longestWordWidth = measureNode.width();
  measureNode.destroy();

  let renderWidth = regionWidth;
  let xOffset = 0;
  // Small buffer so a word that fits within rounding error doesn't trigger a needless grow.
  if (longestWordWidth > regionWidth * 1.02) {
    renderWidth = longestWordWidth * 1.06;
    const extra = renderWidth - regionWidth;
    xOffset = -extra / 2;
    if (regionX + xOffset < 0) xOffset = -regionX;
    if (regionX + xOffset + renderWidth > pageWidth) xOffset = Math.min(xOffset, pageWidth - renderWidth - regionX);
  }

  const requiredHeight = measureWrappedTextHeight(text, renderWidth, fontFamily, fontStyle, lineHeight, letterSpacing, fontSize);
  let renderHeight = regionHeight;
  let yOffset = 0;
  if (requiredHeight > regionHeight) {
    const extra = requiredHeight - regionHeight;
    renderHeight = requiredHeight;
    yOffset = -extra / 2;
    if (regionY + yOffset < 0) yOffset = -regionY;
    if (regionY + yOffset + renderHeight > pageHeight) yOffset = Math.min(yOffset, pageHeight - renderHeight - regionY);
  }

  return { renderWidth, renderHeight, xOffset, yOffset };
}
