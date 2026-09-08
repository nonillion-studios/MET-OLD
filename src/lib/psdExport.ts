// Builds a real, layered Photoshop .psd file per page (Background + one text layer per
// speech bubble/SFX), using ag-psd. Reuses the exact same Konva render path as the
// ZIP/PDF export (renderImageToDataUrl in zip.ts) so PSD output matches what the studio
// and the flattened exports show - just kept as separate, movable/editable layers instead
// of being baked into one flat image.
import { writePsd } from 'ag-psd';
import Konva from 'konva';
import { ProcessedImage } from '../types';
import { calculateAutoFitFontSize, measureWrappedTextHeight, wrapRtlLines } from '../utils/textUtils';

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
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

// One full-page-sized transparent canvas per text region, positioned/rotated by Konva
// exactly like layer 3 of the normal export - kept full-page (rather than tightly cropped)
// so rotated text doesn't get clipped by a naive bounding box.
async function renderTextLayerCanvas(img: ProcessedImage, region: ProcessedImage['regions'][number]): Promise<HTMLCanvasElement | null> {
  if (!region.translatedText || !region.translatedText.trim()) return null;

  const fontStyleStr = `${region.fontStyle === 'normal' ? '' : region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`.trim() || 'normal';

  let renderFontSize = region.fontSize;
  if (region.autoFitText) {
    renderFontSize = calculateAutoFitFontSize(
      region.translatedText, region.width, region.height, region.fontFamily,
      fontStyleStr, region.lineHeight || 1.2, region.letterSpacing || 0, region.fontSize
    );
  }

  let renderHeight = region.height;
  let yOffset = 0;
  const requiredHeight = measureWrappedTextHeight(
    region.translatedText, region.width, region.fontFamily, fontStyleStr,
    region.lineHeight || 1.2, region.letterSpacing || 0, renderFontSize
  );
  if (requiredHeight > region.height) {
    const extra = requiredHeight - region.height;
    renderHeight = requiredHeight;
    yOffset = -extra / 2;
    if (region.y + yOffset < 0) yOffset = -region.y;
    if (region.y + yOffset + renderHeight > img.height) yOffset = Math.min(yOffset, img.height - renderHeight - region.y);
  }

  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: img.width, height: img.height });
  const layer = new Konva.Layer();
  const group = new Konva.Group({ x: region.x, y: region.y + yOffset, width: region.width, height: renderHeight, rotation: region.angle, opacity: region.opacity ?? 1 });
  group.add(new Konva.Text({
    text: wrapRtlLines(region.translatedText),
    width: region.width,
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
  return canvas;
}

// Builds one real, editable-layers PSD ArrayBuffer for a page: a flattened "Background"
// layer plus one named, individually positioned/hideable text layer per bubble/SFX region.
export async function buildPagePsd(img: ProcessedImage): Promise<ArrayBuffer> {
  if ('fonts' in document && (document as any).fonts.status !== 'loaded') {
    await (document as any).fonts.ready;
  }

  const bgCanvas = await renderBackgroundCanvas(img);

  const textLayers: any[] = [];
  for (const region of img.regions) {
    const canvas = await renderTextLayerCanvas(img, region);
    if (!canvas) continue;
    const label = (region.translatedText || 'Text').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Text';
    textLayers.push({
      name: label,
      left: 0,
      top: 0,
      right: img.width,
      bottom: img.height,
      canvas,
      opacity: 255,
      blendMode: 'normal'
    });
  }

  const psd = {
    width: img.width,
    height: img.height,
    children: [
      { name: 'Background (Clean Art)', left: 0, top: 0, right: img.width, bottom: img.height, canvas: bgCanvas },
      ...textLayers
    ]
  };

  return writePsd(psd as any, { generateThumbnail: true });
}
