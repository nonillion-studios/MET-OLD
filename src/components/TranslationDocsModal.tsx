import React, { useState } from 'react';
import { ChevronUp, ChevronDown, X, FileText, Upload } from 'lucide-react';
import mammoth from 'mammoth';
import { ProcessedImage } from '../types';
import { parseTranslationDocText } from '../lib/translationDoc';

interface TranslationDocsModalProps {
  images: ProcessedImage[];
  onConfirm: (pairings: { imageId: string, hint: string }[]) => void;
  onClose: () => void;
}

export function TranslationDocsModal({ images, onConfirm, onClose }: TranslationDocsModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [pairings, setPairings] = useState<(string | null)[]>([]);
  const [unsupportedFile, setUnsupportedFile] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pageBreakMarker, setPageBreakMarker] = useState('');

  const startPairing = (paras: string[]) => {
    const initial = images.map((_, idx) => paras[idx] ?? null);
    setParagraphs(paras);
    setPairings(initial);
    setStep(2);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.docx')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setUnsupportedFile(false);
        startPairing(parseTranslationDocText(result.value, pageBreakMarker));
      } catch (err) {
        console.error('Failed to parse .docx file', err);
        setUnsupportedFile(true);
      }
      return;
    }

    if (lowerName.endsWith('.doc')) {
      setUnsupportedFile(true);
      return;
    }

    setUnsupportedFile(false);
    const text = await file.text();
    startPairing(parseTranslationDocText(text, pageBreakMarker));
  };

  const handlePasteConfirm = () => {
    if (!pasteText.trim()) return;
    startPairing(parseTranslationDocText(pasteText, pageBreakMarker));
  };

  const updatePairing = (index: number, value: string) => {
    setPairings(prev => prev.map((p, i) => (i === index ? value : p)));
  };

  const clearPairing = (index: number) => {
    setPairings(prev => prev.map((p, i) => (i === index ? null : p)));
  };

  const shiftPairing = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= pairings.length) return;
    setPairings(prev => {
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = tmp;
      return next;
    });
  };

  const handleConfirm = () => {
    const result = images
      .map((img, idx) => ({ imageId: img.id, hint: (pairings[idx] || '').trim() }))
      .filter(p => p.hint.length > 0);
    onConfirm(result);
  };

  const extraParagraphsCount = Math.max(0, paragraphs.length - images.length);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in text-left" dir="ltr">
      <div className="liquid-glass p-8 rounded-3xl max-w-3xl w-full mx-4 shadow-[0_20px_50px_rgba(56,189,248,0.3)] border border-sky-500/25 relative text-slate-200 flex flex-col gap-5 max-h-[85vh]">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all text-sm font-bold"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col gap-1.5 text-left border-b border-sky-500/10 pb-4">
          <h2 className="text-2xl font-display font-bold text-white flex items-center gap-2 justify-start">
            <FileText className="text-sky-400" size={22} /> Translation Docs
          </h2>
          <p className="text-xs text-slate-400">
            {step === 1
              ? 'Upload a text file with reference translations, one paragraph per page.'
              : 'Review and adjust the pairing between pages and translated paragraphs, then confirm.'}
          </p>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-sky-500/30 rounded-xl p-8 cursor-pointer hover:bg-blue-950/25 transition-all text-center">
              <Upload className="text-sky-400" size={28} />
              <span className="text-sm text-slate-300">Click to choose a .txt file</span>
              <input
                type="file"
                accept=".txt,.doc,.docx"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400">Page break marker (optional)</label>
              <input
                type="text"
                value={pageBreakMarker}
                onChange={(e) => setPageBreakMarker(e.target.value)}
                placeholder="e.g. ===PAGE=== — leave blank to split on blank lines"
                className="w-full bg-black/40 border border-sky-500/15 rounded-lg p-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500/40"
              />
              <p className="text-[11px] text-slate-500">
                If set, the document is split into pages wherever a line exactly matches this marker, instead of using blank lines to detect page breaks.
              </p>
            </div>

            {unsupportedFile && (
              <div className="flex flex-col gap-2 bg-blue-950/25 border border-sky-500/15 rounded-xl p-4">
                <p className="text-xs text-amber-300">
                  .doc (legacy) isn't supported for direct parsing — please save as .docx or paste the text below.
                </p>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste the translated text here, separating paragraphs with a blank line..."
                  className="w-full h-40 bg-black/40 border border-sky-500/15 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-sky-500/40 resize-none"
                />
                <button
                  onClick={handlePasteConfirm}
                  disabled={!pasteText.trim()}
                  className="self-end bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed px-4 py-2 rounded-md font-medium text-sm transition-colors"
                >
                  Continue
                </button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <>
            <div className="flex flex-col gap-3 overflow-y-auto pr-1">
              {extraParagraphsCount > 0 && (
                <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  {extraParagraphsCount} extra paragraph(s) beyond the number of pages were dropped.
                </p>
              )}
              {images.map((img, idx) => (
                <div
                  key={img.id}
                  className="flex flex-col sm:flex-row gap-3 bg-blue-950/25 border border-sky-500/15 rounded-xl p-3"
                >
                  <div className="flex sm:flex-col items-center gap-2 shrink-0">
                    <img
                      src={img.dataUrl}
                      alt={img.filename}
                      className="w-16 h-16 object-cover rounded-lg border border-sky-500/15"
                    />
                    <span className="text-[10px] text-slate-500 truncate max-w-[6rem]">{img.filename}</span>
                  </div>

                  <textarea
                    value={pairings[idx] || ''}
                    onChange={(e) => updatePairing(idx, e.target.value)}
                    placeholder="No paired text"
                    className="flex-1 h-20 bg-black/40 border border-sky-500/15 rounded-lg p-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500/40 resize-none"
                  />

                  <div className="flex sm:flex-col items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => shiftPairing(idx, -1)}
                      disabled={idx === 0}
                      title="Shift pairing up"
                      className="p-1.5 rounded-md bg-[#111] hover:bg-[#222] disabled:opacity-30 disabled:cursor-not-allowed text-slate-300"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => shiftPairing(idx, 1)}
                      disabled={idx === images.length - 1}
                      title="Shift pairing down"
                      className="p-1.5 rounded-md bg-[#111] hover:bg-[#222] disabled:opacity-30 disabled:cursor-not-allowed text-slate-300"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      onClick={() => clearPairing(idx)}
                      title="Skip this page"
                      className="p-1.5 rounded-md bg-[#111] hover:bg-red-900/40 text-slate-300 hover:text-red-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-sky-500/10 pt-4">
              <button
                onClick={() => setStep(1)}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleConfirm}
                className="bg-blue-600 hover:bg-blue-500 px-5 py-2 rounded-md font-medium text-sm transition-colors"
              >
                Confirm Pairing
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
