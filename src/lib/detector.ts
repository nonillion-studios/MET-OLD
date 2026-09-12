import { Client } from '@gradio/client';
import { floodFillBubbleDetailed } from './bubbleDetect';

// Client for the separate YOLOv11 "Manga-AI-detector" Flask server
// (github.com/nonillion-studios/Manga-AI-detector, see server/ for a scaffold).
// Detects 4 classes: panel, bubble, text, sfx.
//
// The documented /api/detect contract only returns a bbox per detection, but the
// underlying model can also be a segmentation variant that returns per-instance
// polygons/masks (confirmed by the model author, not documented). We stay lenient
// and treat polygon/mask as optional fields.
export interface DetectorBBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectorPoint {
  x: number;
  y: number;
}

export interface DetectorDetection {
  class_name: 'panel' | 'bubble' | 'text' | 'sfx';
  confidence: number;
  bbox: DetectorBBox;
  polygon?: DetectorPoint[];
  mask?: DetectorPoint[];
}

interface DetectResponse {
  success: boolean;
  detections: DetectorDetection[];
  count: number;
  timestamp?: string;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

// Calls POST {endpoint}/api/detect with the page image, returning the parsed
// detections array. Throws a clear error on network failure, non-OK status,
// or a malformed/unexpected response shape.
export async function detectPage(
  imageDataUrl: string,
  endpoint: string,
  confidence: number = 0.25
): Promise<DetectorDetection[]> {
  const baseUrl = endpoint.replace(/\/+$/, '');
  let blob: Blob;
  try {
    blob = await dataUrlToBlob(imageDataUrl);
  } catch (e: any) {
    throw new Error(`Ultra Mode: failed to prepare image for detection: ${e?.message || e}`);
  }

  const formData = new FormData();
  formData.append('image', blob, 'page.jpg');
  formData.append('confidence', String(confidence));

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/detect`, {
      method: 'POST',
      body: formData,
    });
  } catch (e: any) {
    throw new Error(`Ultra Mode: could not reach detector server at ${baseUrl} (${e?.message || e})`);
  }

  if (!response.ok) {
    let bodyText = '';
    try { bodyText = await response.text(); } catch { /* ignore */ }
    throw new Error(`Ultra Mode: detector server returned ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText.slice(0, 300)}` : ''}`);
  }

  let json: DetectResponse;
  try {
    json = await response.json();
  } catch (e: any) {
    throw new Error(`Ultra Mode: detector server returned invalid JSON (${e?.message || e})`);
  }

  if (!json || !Array.isArray(json.detections)) {
    throw new Error('Ultra Mode: detector server response missing a valid "detections" array');
  }

  return json.detections;
}

// Calls a Hugging Face Space (or any self-hosted Gradio app) running server/gradio_app.py,
// via Gradio's own client protocol - NOT a plain fetch/multipart POST like detectPage(),
// since Gradio apps use a queue-based session protocol (Client.connect handles that).
// `spaceIdOrUrl` accepts either a HF Space id ("username/space-name") or a full URL to a
// self-hosted Gradio app. gradio_app.py's gr.Interface has inputs [image, confidence] and
// outputs [annotated_image, detections_json] in that order - result.data mirrors that order.
export async function detectPageViaGradio(
  imageDataUrl: string,
  spaceIdOrUrl: string,
  confidence: number = 0.25
): Promise<DetectorDetection[]> {
  let blob: Blob;
  try {
    blob = await dataUrlToBlob(imageDataUrl);
  } catch (e: any) {
    throw new Error(`Ultra Mode: failed to prepare image for detection: ${e?.message || e}`);
  }

  let client;
  try {
    client = await Client.connect(spaceIdOrUrl);
  } catch (e: any) {
    throw new Error(`Ultra Mode: could not connect to Gradio Space "${spaceIdOrUrl}" (${e?.message || e})`);
  }

  let result;
  try {
    result = await client.predict('/detect', { image: blob, confidence });
  } catch (e: any) {
    throw new Error(`Ultra Mode: Gradio Space call failed (${e?.message || e})`);
  }

  const data = result?.data as any[] | undefined;
  const detectionsPayload = Array.isArray(data) ? data[1] : undefined;
  const detections = detectionsPayload?.detections;

  if (!Array.isArray(detections)) {
    throw new Error('Ultra Mode: Gradio Space response missing a valid "detections" array (expected gradio_app.py\'s output shape)');
  }

  return detections as DetectorDetection[];
}

export interface ResolvedBubbleGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  contour: number[];
  safeTextBounds: { x: number; y: number; width: number; height: number };
}

// Converts a detection's polygon/mask (when present) directly into the same shape
// floodFillBubbleDetailed returns, so downstream region-building code can treat both
// paths identically. Falls back to flood-fill seeded from the bbox center when the
// detector didn't provide geometry beyond the bounding box.
//
// `centerFrom`: an optional second detection (typically a paired 'text' detection sitting
// inside this 'bubble' detection - see pairBubbleAndTextDetections) whose own center should
// be used instead of this detection's natural centroid. This is the "2 connected bubbles"
// fix: when two bubbles touch/overlap, a bubble-shape-derived center can land in the wrong
// spot or span both bubbles, but the text detection inside each one is reliably centered on
// that bubble's actual dialogue. The SIZE (width/height/safeTextBounds dimensions) still
// comes entirely from `detection` - only the position is re-centered.
export function resolveBubblePolygon(
  detection: DetectorDetection,
  imageData: ImageData,
  centerFrom?: DetectorDetection
): ResolvedBubbleGeometry | null {
  const base = resolveGeometryForDetection(detection, imageData);
  if (!base || !centerFrom) return base;

  const target = detectionBboxCenter(centerFrom);
  const currentCenterX = base.x + base.width / 2;
  const currentCenterY = base.y + base.height / 2;
  const dx = target.x - currentCenterX;
  const dy = target.y - currentCenterY;

  return shiftResolvedGeometry(base, dx, dy);
}

function resolveGeometryForDetection(
  detection: DetectorDetection,
  imageData: ImageData
): ResolvedBubbleGeometry | null {
  const points = detection.polygon && detection.polygon.length > 2
    ? detection.polygon
    : (detection.mask && detection.mask.length > 2 ? detection.mask : null);

  if (points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const contour: number[] = [];
    for (const p of points) {
      contour.push(p.x, p.y);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    // Inset the safe-text bounds by ~12.5% on each axis so text doesn't touch the
    // bubble edge, mirroring the margin behavior of floodFillBubbleDetailed.
    const insetRatio = 0.08;
    const insetX = width * insetRatio;
    const insetY = height * insetRatio;

    return {
      x: minX,
      y: minY,
      width,
      height,
      contour,
      safeTextBounds: {
        x: minX + insetX,
        y: minY + insetY,
        width: Math.max(1, width - insetX * 2),
        height: Math.max(1, height - insetY * 2),
      },
    };
  }

  const { bbox } = detection;
  const bboxWidth = bbox.x2 - bbox.x1;
  const bboxHeight = bbox.y2 - bbox.y1;
  const centerX = Math.round(bbox.x1 + bboxWidth / 2);
  const centerY = Math.round(bbox.y1 + bboxHeight / 2);

  const result = floodFillBubbleDetailed(imageData, centerX, centerY, bboxWidth, bboxHeight);
  if (!result) return null;

  return {
    x: result.x,
    y: result.y,
    width: result.width,
    height: result.height,
    contour: result.contour,
    safeTextBounds: result.safeTextBounds,
  };
}

function detectionBboxCenter(detection: DetectorDetection): { x: number; y: number } {
  return {
    x: (detection.bbox.x1 + detection.bbox.x2) / 2,
    y: (detection.bbox.y1 + detection.bbox.y2) / 2,
  };
}

function shiftResolvedGeometry(geometry: ResolvedBubbleGeometry, dx: number, dy: number): ResolvedBubbleGeometry {
  if (dx === 0 && dy === 0) return geometry;
  const contour: number[] = [];
  for (let i = 0; i < geometry.contour.length; i += 2) {
    contour.push(geometry.contour[i] + dx, geometry.contour[i + 1] + dy);
  }
  return {
    x: geometry.x + dx,
    y: geometry.y + dy,
    width: geometry.width,
    height: geometry.height,
    contour,
    safeTextBounds: {
      x: geometry.safeTextBounds.x + dx,
      y: geometry.safeTextBounds.y + dy,
      width: geometry.safeTextBounds.width,
      height: geometry.safeTextBounds.height,
    },
  };
}

function bboxIntersectionArea(a: DetectorBBox, b: DetectorBBox): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function bboxArea(b: DetectorBBox): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
}

export interface PairedSlotDetection {
  // The detection whose geometry sizes the region: a 'bubble' detection when paired with a
  // 'text' detection sitting inside it, or the detection's own geometry for a lone/unpaired
  // 'text'/'sfx' detection.
  primary: DetectorDetection;
  // When set, the paired 'text' detection used to re-center `primary`'s geometry (see
  // resolveBubblePolygon's `centerFrom` parameter) instead of `primary`'s own centroid.
  centerFrom?: DetectorDetection;
}

// Pairs each 'bubble' detection with the 'text' detection (if any) that mostly overlaps it,
// so the two can be treated as one logical region: the bubble's geometry sizes the region,
// the text's geometry centers it. This is the fix for two touching/connected bubbles, where
// a naive bubble-shape center can land in the wrong bubble or straddle both - the text
// detection inside each bubble reliably marks where that bubble's own dialogue actually is.
//
// A 'text' detection that gets paired this way is consumed here and does NOT appear again in
// the returned list, so callers building one numbered marker per entry never double-count the
// same dialogue (once via the bubble, once via its paired text). Unpaired 'text' detections
// (free-floating text with no overlapping bubble) and any other class ('sfx', etc.) pass
// through unchanged as their own entry, using their own geometry for both size and center.
export function pairBubbleAndTextDetections(detections: DetectorDetection[]): PairedSlotDetection[] {
  const bubbles = detections.filter(d => d.class_name === 'bubble');
  const texts = detections.filter(d => d.class_name === 'text');
  const others = detections.filter(d => d.class_name !== 'bubble' && d.class_name !== 'text');

  const usedTextIndices = new Set<number>();
  const result: PairedSlotDetection[] = [];

  for (const bubble of bubbles) {
    let bestIdx = -1;
    let bestOverlap = 0;
    texts.forEach((text, idx) => {
      if (usedTextIndices.has(idx)) return;
      const textArea = bboxArea(text.bbox);
      if (textArea <= 0) return;
      // How much of the TEXT detection sits inside the bubble - the natural measure for
      // "this text belongs to this bubble" regardless of how much larger the bubble is.
      const overlapRatio = bboxIntersectionArea(bubble.bbox, text.bbox) / textArea;
      if (overlapRatio > bestOverlap) {
        bestOverlap = overlapRatio;
        bestIdx = idx;
      }
    });

    // Require most of the text box to sit inside the bubble box before treating them as the
    // same logical region - a low/partial overlap is more likely two unrelated detections.
    if (bestIdx !== -1 && bestOverlap >= 0.5) {
      usedTextIndices.add(bestIdx);
      result.push({ primary: bubble, centerFrom: texts[bestIdx] });
    } else {
      result.push({ primary: bubble });
    }
  }

  texts.forEach((text, idx) => {
    if (!usedTextIndices.has(idx)) result.push({ primary: text });
  });

  result.push(...others.map(d => ({ primary: d })));

  return result;
}
