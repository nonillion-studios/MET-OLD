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
 * @deprecated in favor of computeAutoSplitPlan, which generalizes this to however many
 * pieces a strip actually needs instead of always exactly 3 - kept only because nothing
 * else references the fixed-3-piece shape directly.
 */
export function computeSplitPlan(imageData: ImageData, imgWidth: number, imgHeight: number): SplitPlan {
  return computeAutoSplitPlan(imageData, imgWidth, imgHeight);
}

// Comics/scanlation tooling generally targets ~2000-3000px chunks for long webtoon strips
// (tall enough that each piece still reads as a real page, short enough to stay reliable
// for downstream AI detection/OCR, which tends to degrade on extremely tall images).
const DEFAULT_TARGET_CHUNK_HEIGHT = 2200;
const MIN_PIECE_HEIGHT = 600; // avoid a sliver piece when height doesn't divide evenly

/**
 * Generalizes the old fixed-3-piece split to however many pieces a strip actually needs:
 * picks (N-1) evenly-spaced ideal cut lines based on targetChunkHeight, then snaps each to
 * the nearest genuinely blank row nearby (same window-scan heuristic as before) so cuts
 * still never land inside a bubble/panel/art region. Falls back to the raw ideal line
 * un-snapped if no window in range is even close to blank (e.g. a strip with no white
 * gutters at all - better than crashing or merging pieces unexpectedly).
 */
export function computeAutoSplitPlan(
  imageData: ImageData,
  imgWidth: number,
  imgHeight: number,
  targetChunkHeight: number = DEFAULT_TARGET_CHUNK_HEIGHT
): SplitPlan {
  const data = imageData.data;
  const searchWindow = Math.max(20, Math.floor(imgHeight * 0.04));

  let pieceCount = Math.max(1, Math.round(imgHeight / targetChunkHeight));
  // Don't produce a sliver final piece - if the last piece would be too short, drop one cut.
  if (pieceCount > 1 && imgHeight / pieceCount < MIN_PIECE_HEIGHT) pieceCount = Math.max(1, pieceCount - 1);

  const cutRows: number[] = [];
  for (let i = 1; i < pieceCount; i++) {
    const idealY = (imgHeight * i) / pieceCount;
    let cut = findBestCutRow(data, imgWidth, imgHeight, idealY, searchWindow);
    const prev = cutRows[cutRows.length - 1] ?? 0;
    if (cut <= prev) cut = Math.min(imgHeight - 1, prev + 1);
    cutRows.push(cut);
  }

  return { cutRows, pieceCount: cutRows.length + 1 };
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
