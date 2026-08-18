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

  let minFontSize = 8;
  let maxFontSize = 100;
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
