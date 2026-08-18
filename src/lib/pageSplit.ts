// Smart long-page splitting: finds near-blank gutter rows close to ideal cut lines
// so that splits never land inside a bubble / text / panel-art region.

export const LONG_PAGE_ASPECT_THRESHOLD = 3; // height / width

// Reuses the same luminance-based "light pixel" heuristic as bubbleDetect.ts
function isLightPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 64) return true;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 175;
}

// Fraction of pixels in a row that are "light" (near-blank gutter color)
function rowBlankness(data: Uint8ClampedArray, width: number, y: number): number {
  let light = 0;
  const rowStart = y * width * 4;
  for (let x = 0; x < width; x++) {
    const idx = rowStart + x * 4;
    if (isLightPixel(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])) light++;
  }
  return light / width;
}

/**
 * Finds the row (y coordinate) nearest to `idealY` within +/- `searchWindow` px
 * that is the most uniformly blank (highest fraction of light pixels).
 */
function findBestCutRow(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  idealY: number,
  searchWindow: number
): number {
  let bestY = Math.round(Math.min(Math.max(idealY, 1), height - 1));
  let bestScore = -Infinity;

  const lo = Math.max(1, Math.round(idealY - searchWindow));
  const hi = Math.min(height - 1, Math.round(idealY + searchWindow));

  for (let y = lo; y <= hi; y++) {
    const blankness = rowBlankness(data, width, y);
    // Prefer rows that are near-fully blank; break ties by proximity to the ideal line
    const distancePenalty = Math.abs(y - idealY) / (searchWindow + 1) * 0.05;
    const score = blankness - distancePenalty;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }
  return bestY;
}

export interface SplitPlan {
  cutRows: number[]; // sorted ascending, in source pixel coordinates
  pieceCount: number;
}

/**
 * Computes ~3 pieces by locating 2 cut lines near 1/3 and 2/3 of the page height,
 * snapping each to the nearest genuinely blank row found via a window scan.
 */
export function computeSplitPlan(imageData: ImageData, imgWidth: number, imgHeight: number): SplitPlan {
  const data = imageData.data;
  const searchWindow = Math.max(20, Math.floor(imgHeight * 0.08));

  const idealY1 = imgHeight / 3;
  const idealY2 = (imgHeight * 2) / 3;

  const cut1 = findBestCutRow(data, imgWidth, imgHeight, idealY1, searchWindow);
  let cut2 = findBestCutRow(data, imgWidth, imgHeight, idealY2, searchWindow);
  if (cut2 <= cut1) cut2 = Math.min(imgHeight - 1, cut1 + 1);

  return { cutRows: [cut1, cut2], pieceCount: 3 };
}

/** Returns true if a page's aspect ratio suggests it's an oversized "long strip" page. */
export function isLongPage(width: number, height: number): boolean {
  if (!width || !height) return false;
  return height / width > LONG_PAGE_ASPECT_THRESHOLD;
}

/** Draws an image (by dataUrl) to an offscreen canvas and returns its ImageData. */
export async function getImageDataFromDataUrl(dataUrl: string, width: number, height: number): Promise<ImageData> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** Crops a slice [yStart, yEnd) of a source image (by dataUrl) into its own dataUrl. */
export async function cropSlice(
  dataUrl: string,
  srcWidth: number,
  yStart: number,
  yEnd: number,
  mimeType: string
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });
  const sliceHeight = yEnd - yStart;
  const canvas = document.createElement('canvas');
  canvas.width = srcWidth;
  canvas.height = sliceHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, yStart, srcWidth, sliceHeight, 0, 0, srcWidth, sliceHeight);
  const outMime = mimeType && mimeType.includes('png') ? 'image/png' : (mimeType || 'image/png');
  return { dataUrl: canvas.toDataURL(outMime), width: srcWidth, height: sliceHeight };
}

/**
 * Splits a page's dataUrl into pieces using the given cut rows (in source pixel coords).
 * Returns pieces top-to-bottom.
 */
export async function splitImageByRows(
  dataUrl: string,
  width: number,
  height: number,
  mimeType: string,
  cutRows: number[]
): Promise<{ dataUrl: string; width: number; height: number }[]> {
  const bounds = [0, ...cutRows.filter(y => y > 0 && y < height), height];
  const pieces: { dataUrl: string; width: number; height: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const yStart = bounds[i];
    const yEnd = bounds[i + 1];
    if (yEnd <= yStart) continue;
    pieces.push(await cropSlice(dataUrl, width, yStart, yEnd, mimeType));
  }
  return pieces;
}
