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

export function wrapRtlLines(text: string): string {
  return text.split('\n').map(line => '⁧' + line + '⁩').join('\n');
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

  // Clean and find the longest word
  const words = text.split(/\s+/);
  const longestWord = words.reduce((a, b) => a.length > b.length ? a : b, '');

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
  const longestWord = words.reduce((a, b) => (b.length > a.length ? b : a), '');
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
