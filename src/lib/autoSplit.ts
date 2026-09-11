import { DetectorDetection } from './detector';

// Comics/scanlation tooling generally targets ~2000-3000px chunks for long webtoon strips -
// tall enough each piece still reads as a real page, short enough to stay reliable for
// downstream AI detection/OCR (which tends to degrade on extremely tall images).
const DEFAULT_TARGET_CHUNK_HEIGHT = 2200;

// Only bubble/text/sfx are treated as "never cut through this" zones. `panel` boxes are
// deliberately excluded: a single panel can legitimately span thousands of pixels of a
// webtoon strip, and treating its whole bbox as off-limits would leave almost no safe gaps
// even though there's plenty of blank space between individual speech bubbles inside it.
// Panel boundaries are, if anything, good cut candidates (that's naturally where the art
// separates) - so they're just not fenced off, rather than being actively preferred.
const UNSAFE_CLASSES: DetectorDetection['class_name'][] = ['bubble', 'text', 'sfx'];

/**
 * Given a full webtoon-strip page's YOLO detections (in full-image pixel coordinates, as
 * returned by lib/detector.ts), computes horizontal cut lines that are guaranteed not to
 * cross any detected bubble/text/sfx box - the same guarantee tools like XianScan describe
 * as "recombining and splitting vertical strips along natural panel gutters" so a bubble is
 * never sliced in half across a piece boundary. Returns an empty array if the strip is so
 * densely packed with detections that no safe gap exists anywhere (caller should fall back
 * to the blank-pixel heuristic in pageSplit.ts, or manual cutting).
 */
export function computeDetectionSafeSplitRows(
  detections: DetectorDetection[],
  imgHeight: number,
  targetChunkHeight: number = DEFAULT_TARGET_CHUNK_HEIGHT
): number[] {
  const PADDING = 12; // small buffer so a cut doesn't land pixel-adjacent to a bubble edge

  const occupied = detections
    .filter(d => UNSAFE_CLASSES.includes(d.class_name))
    .map((d): [number, number] => [Math.max(0, d.bbox.y1 - PADDING), Math.min(imgHeight, d.bbox.y2 + PADDING)])
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [start, end] of occupied) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < imgHeight) gaps.push([cursor, imgHeight]);
  if (gaps.length === 0) return [];

  const nearestSafeY = (idealY: number): number | null => {
    // Already inside a safe gap - use the ideal line as-is rather than snapping to that
    // gap's overall midpoint, which would collapse every ideal line inside one large gap
    // (e.g. a strip with few/no detections) onto the exact same point.
    for (const [start, end] of gaps) {
      if (idealY >= start && idealY <= end) return idealY;
    }
    // Outside every gap (idealY landed inside an unsafe bubble/text/sfx box) - jump to
    // whichever gap edge is closest, not that gap's center, for the same reason.
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [start, end] of gaps) {
      const dist = idealY < start ? start - idealY : idealY - end;
      const candidate = idealY < start ? start : end;
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  };

  const pieceCount = Math.max(1, Math.round(imgHeight / targetChunkHeight));
  const cutRows: number[] = [];
  for (let i = 1; i < pieceCount; i++) {
    const idealY = (imgHeight * i) / pieceCount;
    const y = nearestSafeY(idealY);
    if (y === null) continue;
    const rounded = Math.round(y);
    const prev = cutRows[cutRows.length - 1] ?? 0;
    if (rounded > prev && rounded < imgHeight) cutRows.push(rounded);
  }
  return cutRows;
}
