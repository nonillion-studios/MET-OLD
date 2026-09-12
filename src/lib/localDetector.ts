import * as ort from 'onnxruntime-web';
import { DetectorDetection, DetectorPoint } from './detector';
import { traceContour } from './bubbleDetect';

// Fully client-side alternative to the Manga-AI-detector Flask/Gradio server: runs the
// same YOLO11n-seg model (github.com/nonillion-studios/Manga-AI-detector) directly in the
// browser via onnxruntime-web (WASM), so Ultra Mode and the long-strip auto-split feature
// work with no detector server running at all. Also decodes the model's own per-instance
// segmentation mask into a `polygon` - resolveBubblePolygon (lib/detector.ts) already
// prefers a detection's polygon over flood-fill-from-bbox-center when one is present, so
// this gives typesetting a real bubble-shaped contour instead of relying on the bubble
// interior being flood-fillable (works even for textured/non-white bubble fills).

const MODEL_URL = '/models/manga-detector.onnx';
const INPUT_SIZE = 640;
const PROTO_SIZE = 160; // output1's spatial size; INPUT_SIZE / PROTO_SIZE = 4x downsample
const CLASS_NAMES: DetectorDetection['class_name'][] = ['panel', 'bubble', 'text', 'sfx'];

ort.env.wasm.wasmPaths = '/ort/';

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }).catch(err => {
      sessionPromise = null; // allow retrying on next call instead of caching a permanent failure
      throw err;
    });
  }
  return sessionPromise;
}

/** Downloads and compiles the local detector model ahead of time, so the first real
 *  detection call doesn't pay the (one-time, then cached by the browser) load cost. */
export function preloadLocalDetector(): Promise<void> {
  return getSession().then(() => undefined);
}

interface LetterboxMeta {
  scale: number;
  padX: number;
  padY: number;
}

// Resizes+pads an image into a fixed 640x640 CHW float tensor the way Ultralytics'
// letterbox preprocessing does (aspect ratio preserved, gray padding), and records the
// scale/offset needed to map predicted boxes back to the original image's pixel space.
async function letterboxToTensor(imageDataUrl: string): Promise<{ tensor: Float32Array; meta: LetterboxMeta; srcWidth: number; srcHeight: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = imageDataUrl;
  });

  const srcWidth = img.width;
  const srcHeight = img.height;
  const scale = Math.min(INPUT_SIZE / srcWidth, INPUT_SIZE / srcHeight);
  const scaledW = Math.round(srcWidth * scale);
  const scaledH = Math.round(srcHeight * scale);
  const padX = Math.floor((INPUT_SIZE - scaledW) / 2);
  const padY = Math.floor((INPUT_SIZE - scaledH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(114,114,114)'; // Ultralytics' standard letterbox pad color
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(img, 0, 0, srcWidth, srcHeight, padX, padY, scaledW, scaledH);

  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  // HWC uint8 RGBA -> CHW float32 RGB, normalized to [0,1]
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    const srcIdx = i * 4;
    chw[i] = data[srcIdx] / 255;             // R
    chw[plane + i] = data[srcIdx + 1] / 255;   // G
    chw[2 * plane + i] = data[srcIdx + 2] / 255; // B
  }

  return { tensor: chw, meta: { scale, padX, padY }, srcWidth, srcHeight };
}

interface RawBox {
  x1: number; y1: number; x2: number; y2: number; // original image pixel space
  cx640: number; cy640: number; w640: number; h640: number; // 640x640 letterboxed space, for mask cropping
  score: number;
  classId: number;
  maskCoeffs: Float32Array; // 32 values, this anchor's row of coefficients into the prototypes
}

function iou(a: RawBox, b: RawBox): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

// Per-class greedy NMS - suppress lower-confidence boxes of the SAME class that overlap
// a kept box past the IoU threshold. Boxes of different classes never suppress each other
// (a bubble and the text inside it legitimately overlap almost entirely).
function nms(boxes: RawBox[], iouThreshold: number): RawBox[] {
  const byClass = new Map<number, RawBox[]>();
  for (const b of boxes) {
    if (!byClass.has(b.classId)) byClass.set(b.classId, []);
    byClass.get(b.classId)!.push(b);
  }

  const kept: RawBox[] = [];
  for (const group of byClass.values()) {
    const sorted = [...group].sort((a, b) => b.score - a.score);
    const suppressed = new Array(sorted.length).fill(false);
    for (let i = 0; i < sorted.length; i++) {
      if (suppressed[i]) continue;
      kept.push(sorted[i]);
      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed[j]) continue;
        if (iou(sorted[i], sorted[j]) > iouThreshold) suppressed[j] = true;
      }
    }
  }
  return kept;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// Decodes one detection's per-instance segmentation mask (its 32 coefficients dotted with
// the shared (32, 160, 160) prototypes, sigmoid + threshold, cropped to its own box) and
// traces its boundary into a polygon in ORIGINAL image pixel coordinates - the same shape
// resolveBubblePolygon expects from a server-provided detection.polygon.
function decodePolygon(box: RawBox, protoData: Float32Array, meta: LetterboxMeta, srcWidth: number, srcHeight: number): DetectorPoint[] | undefined {
  const protoPlane = PROTO_SIZE * PROTO_SIZE;

  // Box bounds in prototype space (640-space / 4), clamped and with at least a 1px margin.
  const bx1 = Math.max(0, Math.floor((box.cx640 - box.w640 / 2) / 4) - 1);
  const by1 = Math.max(0, Math.floor((box.cy640 - box.h640 / 2) / 4) - 1);
  const bx2 = Math.min(PROTO_SIZE - 1, Math.ceil((box.cx640 + box.w640 / 2) / 4) + 1);
  const by2 = Math.min(PROTO_SIZE - 1, Math.ceil((box.cy640 + box.h640 / 2) / 4) + 1);
  if (bx2 <= bx1 || by2 <= by1) return undefined;

  const mask = new Uint8Array(protoPlane);
  let seedX = -1, seedY = -1;
  for (let y = by1; y <= by2; y++) {
    for (let x = bx1; x <= bx2; x++) {
      let sum = 0;
      for (let c = 0; c < 32; c++) {
        sum += box.maskCoeffs[c] * protoData[c * protoPlane + y * PROTO_SIZE + x];
      }
      if (sigmoid(sum) > 0.5) {
        mask[y * PROTO_SIZE + x] = 1;
        if (seedX === -1) { seedX = x; seedY = y; }
      }
    }
  }
  if (seedX === -1) return undefined; // model gave a box but no confident mask pixels - fall back to bbox

  const contourFlat = traceContour(mask, PROTO_SIZE, PROTO_SIZE, seedX, seedY);
  if (contourFlat.length < 6) return undefined; // fewer than 3 points - degenerate

  const points: DetectorPoint[] = [];
  for (let i = 0; i < contourFlat.length; i += 2) {
    // proto-space -> 640-space (x4) -> undo letterbox pad/scale -> original image pixels
    const x = (contourFlat[i] * 4 - meta.padX) / meta.scale;
    const y = (contourFlat[i + 1] * 4 - meta.padY) / meta.scale;
    points.push({
      x: Math.max(0, Math.min(srcWidth, x)),
      y: Math.max(0, Math.min(srcHeight, y)),
    });
  }
  return points;
}

/**
 * Runs the local (in-browser) YOLO detector on a page image. Mirrors detectPage /
 * detectPageViaGradio's contract (lib/detector.ts): same confidence semantics, same
 * DetectorDetection[] shape, boxes (and, when decodable, polygons) in the ORIGINAL image's
 * pixel coordinates.
 */
export async function detectPageLocally(
  imageDataUrl: string,
  confidence: number = 0.25,
  iouThreshold: number = 0.45
): Promise<DetectorDetection[]> {
  const session = await getSession();
  const { tensor, meta, srcWidth, srcHeight } = await letterboxToTensor(imageDataUrl);

  const inputTensor = new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const outputs = await session.run({ images: inputTensor });
  const output0 = outputs.output0; // [1, 40, 8400]: 4 box coords + 4 class scores + 32 mask coeffs, per anchor
  const data = output0.data as Float32Array;
  const numAnchors = output0.dims[2];
  const numClasses = CLASS_NAMES.length;
  const protoData = outputs.output1.data as Float32Array; // [1, 32, 160, 160]

  const rawBoxes: RawBox[] = [];
  for (let a = 0; a < numAnchors; a++) {
    let bestScore = 0;
    let bestClass = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numAnchors + a];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestScore < confidence) continue;

    const cx = data[0 * numAnchors + a];
    const cy = data[1 * numAnchors + a];
    const w = data[2 * numAnchors + a];
    const h = data[3 * numAnchors + a];

    // Box is in 640x640 letterboxed space - undo padding then scale back to source pixels.
    const x1 = ((cx - w / 2) - meta.padX) / meta.scale;
    const y1 = ((cy - h / 2) - meta.padY) / meta.scale;
    const x2 = ((cx + w / 2) - meta.padX) / meta.scale;
    const y2 = ((cy + h / 2) - meta.padY) / meta.scale;

    const maskCoeffs = new Float32Array(32);
    for (let c = 0; c < 32; c++) {
      maskCoeffs[c] = data[(4 + numClasses + c) * numAnchors + a];
    }

    rawBoxes.push({
      x1: Math.max(0, Math.min(srcWidth, x1)),
      y1: Math.max(0, Math.min(srcHeight, y1)),
      x2: Math.max(0, Math.min(srcWidth, x2)),
      y2: Math.max(0, Math.min(srcHeight, y2)),
      cx640: cx, cy640: cy, w640: w, h640: h,
      score: bestScore,
      classId: bestClass,
      maskCoeffs,
    });
  }

  const kept = nms(rawBoxes, iouThreshold);

  return kept.map((b): DetectorDetection => {
    const polygon = decodePolygon(b, protoData, meta, srcWidth, srcHeight);
    return {
      class_name: CLASS_NAMES[b.classId],
      confidence: b.score,
      bbox: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
      polygon,
    };
  });
}
