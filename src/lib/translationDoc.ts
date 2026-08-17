import { ProcessedImage } from '../types';

export function createTranslationDoc(images: ProcessedImage[]): string {
  let doc = `====================== ⚠️ Important Instructions for Translators ⚠️ ======================
1. This file is meant for translating the text and making your work easier with external translation tools.
2. Always write the requested translation directly below the word "Translation:" only.
3. It is strictly forbidden to change or delete the lines starting with [ID:] because they are required for the system to identify the box.
4. Keep the line containing [END] after the end of each text's translation and never delete it (it marks the end of the text box).
5. You are free to use more than one line (Enter) in the translation within a single box.
6. At the end of this file there is a section called "Editing and Coordinates Data". Please do not touch or delete it!
=========================================================================\n\n`;

  images.forEach(img => {
    if (img.regions.length === 0) return;
    doc += `------------------------------------------------------------\n`;
    doc += `📄 Page: ${img.filename}\n`;
    doc += `------------------------------------------------------------\n\n`;
    img.regions.forEach((r, idx) => {
      doc += `[ID: ${r.id}]\n`;
      doc += `💬 Type: ${r.type === 'bubble' ? 'Dialogue Bubble' : 'Sound Effect (SFX)'} | Text Number: ${idx + 1}\n`;
      doc += `🇯🇵 Original Text:\n${r.originalText || '(empty)'}\n\n`;
      doc += `Translation:\n${r.translatedText || ''}\n`;
      doc += `[END]\n\n`;
    });
  });

  doc += `============== Editing and Coordinates Data (do not touch this part) ==============\n`;
  const metadata = images.map(img => ({
    id: img.id,
    filename: img.filename,
    regions: img.regions.map(r => ({
      id: r.id,
      x: r.x, y: r.y, width: r.width, height: r.height,
      angle: r.angle, textColor: r.textColor, strokeColor: r.strokeColor,
      strokeWidth: r.strokeWidth, bgColor: r.bgColor, fontFamily: r.fontFamily,
      fontSize: r.fontSize, fontWeight: r.fontWeight, fontStyle: r.fontStyle,
      textAlign: r.textAlign, lineHeight: r.lineHeight, autoFitText: r.autoFitText,
      shadowBlur: r.shadowBlur, shadowColor: r.shadowColor
    }))
  }));
  doc += JSON.stringify(metadata);

  return doc;
}

export function parseTranslationDoc(docText: string, currentImages: ProcessedImage[]): ProcessedImage[] {
  const translations: Record<string, string> = {};

  // Extract texts based on ID and [END]
  const regex = /\[ID:\s*([a-zA-Z0-9-]+)\][\s\S]*?Translation:\n([\s\S]*?)\n(?:\[END\])/g;
  let match;
  while ((match = regex.exec(docText)) !== null) {
     const id = match[1];
     let translated = match[2];
     // remove trailing and leading space/newlines but keep internal ones
     translated = translated.replace(/^\s+|\s+$/g, '');
     translations[id] = translated;
  }

  // Update images maintaining everything else
  return currentImages.map(img => ({
    ...img,
    regions: img.regions.map(r => {
      if (translations[r.id] !== undefined) {
         return { ...r, translatedText: translations[r.id] };
      }
      return r;
    })
  }));
}
