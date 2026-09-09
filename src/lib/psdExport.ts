// Builds a real, layered Photoshop .psd file per page (Background + one text layer per
// speech bubble/SFX), using ag-psd. Reuses the exact same Konva render path as the
// ZIP/PDF export (renderImageToDataUrl in zip.ts) so PSD output matches what the studio
// and the flattened exports show - just kept as separate, movable/editable layers instead
// of being baked into one flat image.
import { writePsd } from 'ag-psd';
import Konva from 'konva';
import { ProcessedImage } from '../types';
import { calculateAutoFitFontSize, calculateAutoFitBox, wrapRtlLines } from '../utils/textUtils';

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

// document.fonts.ready resolves once and stays resolved, but awaiting the raw promise
// still costs a microtask hop on every call; cache it so a multi-page PSD export doesn't
// re-await it per page.
let fontsReadyPromise: Promise<unknown> | null = null;
function waitForFontsReady(): Promise<unknown> {
  if (!('fonts' in document)) return Promise.resolve();
  if (!fontsReadyPromise) fontsReadyPromise = (document as any).fonts.ready;
  return fontsReadyPromise;
}

// Layer 1+2 of the normal export renderer (background art, paint strokes, region bg fills)
// flattened into one raster canvas - this becomes the PSD's "Background" layer.
async function renderBackgroundCanvas(img: ProcessedImage): Promise<HTMLCanvasElement> {
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: img.width, height: img.height });
  const layer1 = new Konva.Layer();
  const layer2 = new Konva.Layer();

  const imageObj = await loadImage(img.dataUrl);
  layer1.add(new Konva.Image({ image: imageObj, x: 0, y: 0, width: img.width, height: img.height }));

  const strokesToRender = img.originalDataUrl ? [] : img.paintStrokes;
  const normalStrokes = strokesToRender.filter(s => s.tool !== 'bg_erase');
  const bgEraseStrokes = strokesToRender.filter(s => s.tool === 'bg_erase');

  for (const stroke of normalStrokes) {
    if (stroke.imageBase64 && stroke.rect) {
      const patchImg = await loadImage(stroke.imageBase64.startsWith('data:') ? stroke.imageBase64 : `data:image/jpeg;base64,${stroke.imageBase64}`);
      layer1.add(new Konva.Image({ image: patchImg, x: stroke.rect.x, y: stroke.rect.y, width: stroke.rect.w, height: stroke.rect.h }));
    } else {
      layer1.add(new Konva.Line({
        points: stroke.points,
        stroke: stroke.tool === 'fill_poly' ? (stroke.points.length === 8 ? 'transparent' : stroke.color) : stroke.color,
        strokeWidth: stroke.tool === 'fill_poly' ? Math.max(1, stroke.size) : stroke.size,
        fill: stroke.tool === 'fill_poly' ? stroke.color : undefined,
        closed: stroke.tool === 'fill_poly',
        tension: stroke.tool === 'fill_poly' ? 0 : 0.5,
        lineCap: 'round',
        lineJoin: 'round'
      }));
    }
  }

  img.regions.forEach(region => {
    if (region.bgColor === 'transparent') return;
    const contour = (region as any).bubbleContour;
    if (region.type === 'bubble' && contour && contour.length > 0) {
      layer2.add(new Konva.Line({
        points: contour, closed: true, fill: region.bgColor, stroke: region.bgColor,
        strokeWidth: 1.5, lineJoin: 'round', lineCap: 'round', opacity: region.opacity ?? 1
      }));
    } else {
      const group = new Konva.Group({
        x: region.x + region.width / 2, y: region.y + region.height / 2,
        rotation: region.angle, offset: { x: region.width / 2, y: region.height / 2 }
      });
      group.add(new Konva.Rect({ width: region.width, height: region.height, fill: region.bgColor, cornerRadius: region.type === 'bubble' ? 10 : 0 }));
      layer2.add(group);
    }
  });

  for (const stroke of bgEraseStrokes) {
    layer2.add(new Konva.Line({
      points: stroke.points, stroke: 'black', strokeWidth: stroke.size, tension: 0.5,
      lineCap: 'round', lineJoin: 'round', globalCompositeOperation: 'destination-out'
    }));
  }

  stage.add(layer1);
  stage.add(layer2);
  await new Promise(resolve => setTimeout(resolve, 30));
  const canvas = stage.toCanvas({ pixelRatio: 1 });
  stage.destroy();
  return canvas;
}

// A rotated rect's axis-aligned bounding box is wider/taller than the rect itself; this
// computes that box (relative to the rect's own top-left) so a "tight crop" text layer
// canvas can be sized to contain the rotated text without clipping it.
function rotatedBoundingBox(width: number, height: number, angleDeg: number): { width: number; height: number; offsetX: number; offsetY: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = width * cos + height * sin;
  const h = width * sin + height * cos;
  return { width: w, height: h, offsetX: (w - width) / 2, offsetY: (h - height) / 2 };
}

// Full-page-sized transparent canvas per text region, positioned/rotated by Konva exactly
// like layer 3 of the normal export. Full-page is the safe default since ag-psd layer
// canvases carry no rotation metadata of their own - the rotation is baked into the pixels,
// so a canvas that's too tight WILL clip an angled bubble/SFX. `tightCrop` opts into a
// canvas sized to the region's rotated bounding box (plus padding) instead, trading a
// little of that safety margin for much smaller/faster-to-open PSDs when pages have many
// small regions.
async function renderTextLayerCanvas(img: ProcessedImage, region: ProcessedImage['regions'][number], tightCrop: boolean): Promise<{ canvas: HTMLCanvasElement; left: number; top: number } | null> {
  if (!region.translatedText || !region.translatedText.trim()) return null;

  const fontStyleStr = `${region.fontStyle === 'normal' ? '' : region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`.trim() || 'normal';

  let renderFontSize = region.fontSize;
  if (region.autoFitText) {
    renderFontSize = calculateAutoFitFontSize(
      region.translatedText, region.width, region.height, region.fontFamily,
      fontStyleStr, region.lineHeight || 1.2, region.letterSpacing || 0, region.fontSize
    );
  }

  // Grows the rendered box (width first, then height) exactly like the studio editor and
  // the ZIP/PDF export do - see calculateAutoFitBox for why width has to be checked too.
  const { renderWidth, renderHeight, xOffset, yOffset } = calculateAutoFitBox(
    region.translatedText, region.x, region.y, region.width, region.height,
    region.fontFamily, fontStyleStr, region.lineHeight || 1.2, region.letterSpacing || 0,
    renderFontSize, img.width, img.height
  );

  // Padding beyond the rotated bounding box to absorb stroke/shadow bleed at the edges.
  const CROP_PADDING = 16;

  let stageWidth = img.width;
  let stageHeight = img.height;
  let originX = 0;
  let originY = 0;

  if (tightCrop) {
    const bbox = rotatedBoundingBox(renderWidth, renderHeight, region.angle);
    const centerX = region.x + xOffset + renderWidth / 2;
    const centerY = region.y + yOffset + renderHeight / 2;
    const cropLeft = Math.floor(Math.max(0, centerX - bbox.width / 2 - CROP_PADDING));
    const cropTop = Math.floor(Math.max(0, centerY - bbox.height / 2 - CROP_PADDING));
    const cropRight = Math.ceil(Math.min(img.width, centerX + bbox.width / 2 + CROP_PADDING));
    const cropBottom = Math.ceil(Math.min(img.height, centerY + bbox.height / 2 + CROP_PADDING));
    originX = cropLeft;
    originY = cropTop;
    stageWidth = Math.max(1, cropRight - cropLeft);
    stageHeight = Math.max(1, cropBottom - cropTop);
  }

  // The group stays pinned to the region's own top-left/rotation pivot (matching the
  // studio editor); the grow offset is applied to the Text node's LOCAL position inside
  // the already-rotated frame instead of shifting the group's pivot - see zip.ts for the
  // same reasoning.
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: stageWidth, height: stageHeight });
  const layer = new Konva.Layer();
  const group = new Konva.Group({ x: region.x - originX, y: region.y - originY, width: region.width, height: region.height, rotation: region.angle, opacity: region.opacity ?? 1 });
  group.add(new Konva.Text({
    text: wrapRtlLines(region.translatedText),
    x: xOffset,
    y: yOffset,
    width: renderWidth,
    height: renderHeight,
    fill: region.textColor,
    stroke: region.strokeColor !== 'transparent' ? region.strokeColor : undefined,
    strokeWidth: region.strokeColor !== 'transparent' ? region.strokeWidth : 0,
    fontFamily: region.fontFamily,
    fontSize: renderFontSize,
    fontStyle: fontStyleStr,
    align: region.textAlign,
    verticalAlign: 'middle',
    wrap: 'word',
    lineHeight: region.lineHeight || 1.2,
    fillAfterStrokeEnabled: true,
    shadowColor: region.shadowColor !== 'transparent' && !!region.shadowColor ? region.shadowColor : undefined,
    shadowBlur: region.shadowBlur || 0,
    letterSpacing: region.letterSpacing || 0
  }));
  layer.add(group);
  stage.add(layer);
  await new Promise(resolve => setTimeout(resolve, 10));
  const canvas = stage.toCanvas({ pixelRatio: 1 });
  stage.destroy();
  return { canvas, left: originX, top: originY };
}

export interface BuildPagePsdOptions {
  // Crop each text layer's canvas to its rotated bounding box instead of the full page.
  // Smaller/faster-to-open PSDs, at a (small, padded) risk of clipping extreme rotations.
  tightCrop?: boolean;
  // Bake the background and every text region into a single flattened layer instead of
  // keeping per-bubble text layers - useful when the receiving workflow only ever needs
  // the finished page and per-layer editability would just add file size/open time.
  flatten?: boolean;
}

// The first 4 bytes of any valid .psd/.psb file ("8BPS"), used as a cheap sanity check
// that ag-psd actually produced a well-formed file rather than silently writing a
// truncated/corrupt buffer that would only surface as "Photoshop can't open this file"
// much later, disconnected from the export action that caused it.
const PSD_MAGIC = '8BPS';
function assertValidPsdSignature(buffer: ArrayBuffer, pageLabel: string) {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const signature = String.fromCharCode(...bytes);
  if (signature !== PSD_MAGIC) {
    throw new Error(`Generated PSD for "${pageLabel}" is malformed (bad signature "${signature}") - refusing to export a broken file.`);
  }
}

// Builds one real PSD ArrayBuffer for a page. By default: a flattened "Background" layer
// plus one named, individually positioned/hideable text layer per bubble/SFX region. See
// BuildPagePsdOptions for the tight-crop and single-layer-flatten variants.
export async function buildPagePsd(img: ProcessedImage, options: BuildPagePsdOptions = {}): Promise<ArrayBuffer> {
  await waitForFontsReady();

  const bgCanvas = await renderBackgroundCanvas(img);

  const textLayerResults: { canvas: HTMLCanvasElement; left: number; top: number; label: string }[] = [];
  for (const region of img.regions) {
    const result = await renderTextLayerCanvas(img, region, !!options.tightCrop);
    if (!result) continue;
    const label = (region.translatedText || 'Text').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Text';
    textLayerResults.push({ ...result, label });
  }

  let children: any[];
  if (options.flatten) {
    const flatCanvas = document.createElement('canvas');
    flatCanvas.width = img.width;
    flatCanvas.height = img.height;
    const ctx = flatCanvas.getContext('2d')!;
    ctx.drawImage(bgCanvas, 0, 0);
    for (const layer of textLayerResults) {
      ctx.drawImage(layer.canvas, layer.left, layer.top);
    }
    children = [{ name: 'Flattened Page', left: 0, top: 0, right: img.width, bottom: img.height, canvas: flatCanvas }];
  } else {
    children = [
      { name: 'Background (Clean Art)', left: 0, top: 0, right: img.width, bottom: img.height, canvas: bgCanvas },
      ...textLayerResults.map(layer => ({
        name: layer.label,
        left: layer.left,
        top: layer.top,
        right: layer.left + layer.canvas.width,
        bottom: layer.top + layer.canvas.height,
        canvas: layer.canvas,
        opacity: 255,
        blendMode: 'normal'
      }))
    ];
  }

  const psd = { width: img.width, height: img.height, children };

  const buffer = writePsd(psd as any, { generateThumbnail: true });
  assertValidPsdSignature(buffer, img.filename || 'page');
  return buffer;
}
