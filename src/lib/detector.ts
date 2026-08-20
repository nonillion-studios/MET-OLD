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
    result = await client.predict('/predict', { image: blob, confidence });
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
export function resolveBubblePolygon(
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
    const insetRatio = 0.125;
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
