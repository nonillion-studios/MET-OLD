import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';
import { ProcessedImage } from '../types';
import { calculateAutoFitFontSize } from '../utils/textUtils';

export async function extractImagesFromZip(file: File): Promise<ProcessedImage[]> {
  const zip = await JSZip.loadAsync(file);
  const images: ProcessedImage[] = [];

  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir || filename.startsWith('__MACOSX/')) continue;
    
    // Check if it's an image
    const isImage = filename.match(/\.(jpeg|jpg|png|webp|gif)$/i);
    if (!isImage) continue;

    const base64 = await zipEntry.async('base64');
    let mimeType = 'image/jpeg';
    if (filename.toLowerCase().endsWith('.png')) mimeType = 'image/png';
    else if (filename.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
    else if (filename.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';

    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Get image dimensions
    const dimensions = await new Promise<{width: number, height: number}>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.src = dataUrl;
    });

    const basename = filename.split('/').pop() || filename;

    images.push({
      id: Math.random().toString(36).substr(2, 9),
      filename: basename,
      dataUrl,
      mimeType,
      regions: [],
      paintStrokes: [],
      status: "idle",
      width: dimensions.width,
      height: dimensions.height
    });
  }

  // Sort naturally by filename
  return images.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
}

async function renderImageToDataUrl(img: ProcessedImage, format: 'jpeg' | 'png' = 'png', quality = 1.0): Promise<string> {
  if ('fonts' in document) await (document as any).fonts.ready;
  // @ts-ignore
  const Konva = window.Konva || await import('konva').then(m => m.default || m);
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: img.width, height: img.height });
  
  const layer1 = new Konva.Layer();
  const layer2 = new Konva.Layer();
  const layer3 = new Konva.Layer();
  
  const imageObj = new Image();
  await new Promise((resolve, reject) => {
    imageObj.onload = resolve; imageObj.onerror = reject; imageObj.src = img.dataUrl;
  });
  layer1.add(new Konva.Image({ image: imageObj, x: 0, y: 0, width: img.width, height: img.height }));

  const strokesToRender = img.originalDataUrl 
    ? [] // Hide all paint strokes when rendering cleaned images, we only want text overlay
    : img.paintStrokes;
    
  const normalStrokes = strokesToRender.filter(s => s.tool !== 'bg_erase');
  const bgEraseStrokes = strokesToRender.filter(s => s.tool === 'bg_erase');

  for (const stroke of normalStrokes) {
    if (stroke.imageBase64 && stroke.rect) {
      const patchImg = new Image();
      await new Promise((resolve, reject) => { patchImg.onload = resolve; patchImg.onerror = reject; patchImg.src = stroke.imageBase64!.startsWith('data:') ? stroke.imageBase64! : `data:image/jpeg;base64,${stroke.imageBase64}`; });
      layer1.add(new Konva.Image({ image: patchImg, x: stroke.rect.x, y: stroke.rect.y, width: stroke.rect.w, height: stroke.rect.h }));
    } else {
      layer1.add(new Konva.Line({ points: stroke.points, stroke: stroke.tool === 'fill_poly' ? (stroke.points.length === 8 ? 'transparent' : stroke.color) : stroke.color, strokeWidth: stroke.tool === 'fill_poly' ? Math.max(1, stroke.size) : stroke.size, fill: stroke.tool === 'fill_poly' ? stroke.color : undefined, closed: stroke.tool === 'fill_poly', tension: stroke.tool === 'fill_poly' ? 0 : 0.5, lineCap: 'round', lineJoin: 'round' }));
    }
  }

  img.regions.forEach(region => {
    if (region.bgColor !== 'transparent') {
      const contour = (region as any).bubbleContour;
      if (region.type === 'bubble' && contour && contour.length > 0) {
        layer2.add(new Konva.Line({
          points: contour,
          closed: true,
          fill: region.bgColor,
          stroke: region.bgColor,
          strokeWidth: 1.5,
          lineJoin: 'round',
          lineCap: 'round',
          opacity: region.opacity ?? 1
        }));
      } else {
        const group = new Konva.Group({ x: region.x + region.width / 2, y: region.y + region.height / 2, rotation: region.angle, offset: { x: region.width / 2, y: region.height / 2 } });
        group.add(new Konva.Rect({ width: region.width, height: region.height, fill: region.bgColor, cornerRadius: region.type === 'bubble' ? 10 : 0 }));
        layer2.add(group);
      }
    }
  });

  for (const stroke of bgEraseStrokes) {
    layer2.add(new Konva.Line({ points: stroke.points, stroke: 'black', strokeWidth: stroke.size, tension: 0.5, lineCap: 'round', lineJoin: 'round', globalCompositeOperation: 'destination-out' }));
  }

  img.regions.forEach(region => {
    const fontStyleStr = `${region.fontStyle === 'normal' ? '' : region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`.trim() || 'normal';
    
    let renderFontSize = region.fontSize;
    if (region.autoFitText) {
      renderFontSize = calculateAutoFitFontSize(
        region.translatedText || '',
        region.width,
        region.height,
        region.fontFamily,
        fontStyleStr,
        region.lineHeight || 1.2,
        region.letterSpacing || 0,
        region.fontSize
      );
    }

    const group = new Konva.Group({ x: region.x, y: region.y, width: region.width, height: region.height, rotation: region.angle, opacity: region.opacity ?? 1 });
    group.add(new Konva.Text({ 
      text: region.translatedText ? region.translatedText.split('\n').map(line => '\u202B' + line + '\u200F').join('\n') : '', 
      width: region.width, 
      height: region.height, 
      fill: region.textColor, 
      stroke: region.strokeColor !== 'transparent' ? region.strokeColor : undefined, 
      strokeWidth: region.strokeColor !== 'transparent' ? region.strokeWidth : 0, 
      fontFamily: region.fontFamily, 
      fontSize: renderFontSize, 
      fontStyle: fontStyleStr, 
      align: region.textAlign, 
      verticalAlign: 'middle', 
      wrap: 'word', 
      lineHeight: region.lineHeight, 
      fillAfterStrokeEnabled: true,
      shadowColor: region.shadowColor !== 'transparent' && !!region.shadowColor ? region.shadowColor : undefined,
      shadowBlur: region.shadowBlur || 0,
      letterSpacing: region.letterSpacing || 0
    }));
    layer3.add(group);
  });
  
  stage.add(layer1);
  stage.add(layer2);
  stage.add(layer3);
  
  await new Promise(resolve => setTimeout(resolve, 50));
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const dataUrl = stage.toDataURL({ mimeType: mime, quality, pixelRatio: 1 });
  stage.destroy();
  return dataUrl;
}

// Groups consecutive ProcessedImages that share a splitGroupId into ordered runs.
// Non-split pages come back as single-element groups so callers can treat all
// entries uniformly.
function groupBySplit(processedImages: ProcessedImage[]): ProcessedImage[][] {
  const groups: ProcessedImage[][] = [];
  let i = 0;
  while (i < processedImages.length) {
    const img = processedImages[i];
    if (!img.splitGroupId) {
      groups.push([img]);
      i++;
      continue;
    }
    const run: ProcessedImage[] = [img];
    let j = i + 1;
    while (j < processedImages.length && processedImages[j].splitGroupId === img.splitGroupId) {
      run.push(processedImages[j]);
      j++;
    }
    run.sort((a, b) => (a.splitIndex ?? 0) - (b.splitIndex ?? 0));
    groups.push(run);
    i = j;
  }
  return groups;
}

// Vertically stacks already-rendered piece dataUrls into one composite image.
async function stackDataUrls(dataUrls: string[], mimeType: string): Promise<string> {
  const imgs = await Promise.all(dataUrls.map(du => new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = du;
  })));
  const width = Math.max(...imgs.map(im => im.width));
  const totalHeight = imgs.reduce((sum, im) => sum + im.height, 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d')!;
  let y = 0;
  for (const im of imgs) {
    ctx.drawImage(im, 0, y);
    y += im.height;
  }
  const mime = mimeType?.includes('jpeg') ? 'image/jpeg' : 'image/png';
  return canvas.toDataURL(mime);
}

async function renderGroupToDataUrl(group: ProcessedImage[], format: 'jpeg' | 'png'): Promise<string> {
  if (group.length === 1) {
    const img = group[0];
    if (img.status !== 'done' && (!img.regions || img.regions.length === 0) && (!img.paintStrokes || img.paintStrokes.length === 0)) {
      return img.dataUrl;
    }
    return renderImageToDataUrl(img, format);
  }
  const pieceDataUrls = await Promise.all(group.map(img => {
    if (img.status !== 'done' && (!img.regions || img.regions.length === 0) && (!img.paintStrokes || img.paintStrokes.length === 0)) {
      return img.dataUrl;
    }
    return renderImageToDataUrl(img, format);
  }));
  return stackDataUrls(pieceDataUrls, group[0].mimeType);
}

export async function downloadProcessedZip(processedImages: ProcessedImage[], setProgress?: (msg: string) => void, zipFileName = 'translated_manga.zip') {
  try {
    const zip = new JSZip();
    const groups = groupBySplit(processedImages);

    for (let idx = 0; idx < groups.length; idx++) {
      const group = groups[idx];
      if (typeof setProgress === 'function') setProgress(`Processing page ${idx + 1} of ${groups.length}...`);

      const ext = group[0].filename.split('.').pop() || 'png';
      const newFilename = `page-${String(idx + 1).padStart(3, '0')}.${ext}`;
      const format = group[0].mimeType?.includes('jpeg') ? 'jpeg' : 'png';

      const dataUrl = await renderGroupToDataUrl(group, format);
      zip.file(newFilename, dataUrl.split(',')[1], { base64: true });
    }

    if (typeof setProgress === 'function') setProgress('Zipping files...');
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, typeof setProgress === 'string' ? setProgress : zipFileName);
  } catch (err) {
    console.error("Zip Error:", err);
    throw err;
  }
}

export async function downloadSingleImage(img: ProcessedImage) {
  const dataUrl = await renderImageToDataUrl(img, img.mimeType?.includes('jpeg') ? 'jpeg' : 'png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `translated-${img.filename}`;
  a.click();
}

export async function downloadPdf(processedImages: ProcessedImage[], setProgress?: (p: string) => void) {
  const pdf = new jsPDF();
  let isFirstPage = true;
  const groups = groupBySplit(processedImages);

  for (let idx = 0; idx < groups.length; idx++) {
    const group = groups[idx];
    if (setProgress) setProgress(`Processing PDF page ${idx + 1} of ${groups.length}...`);

    let finalDataUrl: string;
    if (group.length === 1) {
      const img = group[0];
      finalDataUrl = img.dataUrl;
      if (img.status === 'done' || img.regions.length > 0 || img.paintStrokes.length > 0) {
        finalDataUrl = await renderImageToDataUrl(img, 'jpeg', 0.9);
      }
    } else {
      finalDataUrl = await renderGroupToDataUrl(group, 'jpeg');
    }

    const imgProps = pdf.getImageProperties(finalDataUrl);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    if (!isFirstPage) {
      pdf.addPage([pdfWidth, pdfHeight]);
    } else {
      isFirstPage = false;
      pdf.setPage(1);
      pdf.internal.pageSize.width = pdfWidth;
      pdf.internal.pageSize.height = pdfHeight;
    }
    
    pdf.addImage(finalDataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);
  }

  if (setProgress) setProgress('Generating PDF...');
  pdf.save('translated_manga.pdf');
}
