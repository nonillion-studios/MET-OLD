import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, X, FileText, Upload, BookOpen, List } from 'lucide-react';
import mammoth from 'mammoth';
import { ProcessedImage } from '../types';
import { parseTranslationDocText, detectPageMarkers } from '../lib/translationDoc';

interface TranslationDocsModalProps {
  images: ProcessedImage[];
  onConfirm: (pairings: { imageId: string, hint: string }[]) => void;
  onClose: () => void;
}

// Splits the raw document text into paragraph-ish chunks used as clickable units in the
// Paper View (start/end pointers snap to these boundaries rather than arbitrary character
// offsets — simpler and reliable enough for marking page boundaries by eye).
function splitIntoBlocks(fileText: string): { text: string; start: number; end: number }[] {
  const blocks: { text: string; start: number; end: number }[] = [];
  const lines = fileText.split(/\r?\n/);
  let offset = 0;
  let current: { text: string; start: number }[] = [];
  let blockStart = 0;

  const flush = (endOffset: number) => {
    if (current.length === 0) return;
    const text = current.map(c => c.text).join('\n').trim();
    if (text.length > 0) blocks.push({ text, start: blockStart, end: endOffset });
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineLen = line.length;
    const nextOffset = lineStart + lineLen + 1; // +1 for the newline consumed by split
    if (line.trim() === '') {
      flush(lineStart);
      blockStart = nextOffset;
    } else {
      if (current.length === 0) blockStart = lineStart;
      current.push({ text: line, start: lineStart });
    }
    offset = nextOffset;
  }
  flush(Math.min(offset, fileText.length));

  return blocks;
}

export function TranslationDocsModal({ images, onConfirm, onClose }: TranslationDocsModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [viewMode, setViewMode] = useState<'list' | 'paper'>('list');
  const [docText, setDocText] = useState('');
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [pairings, setPairings] = useState<(string | null)[]>([]);
  const [unsupportedFile, setUnsupportedFile] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pageBreakMarker, setPageBreakMarker] = useState('');

  // Paper View state: which page (index into `images`) is currently being marked, the
  // block-index start/end pointers for each page, and the block list for the full doc text.
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [pageRanges, setPageRanges] = useState<(({ startBlock: number; endBlock: number }) | null)[]>([]);

  const blocks = useMemo(() => splitIntoBlocks(docText), [docText]);

  const startPairing = (paras: string[], fullText: string) => {
    const initial = images.map((_, idx) => paras[idx] ?? null);
    setParagraphs(paras);
    setPairings(initial);
    setDocText(fullText);

    // Attempt automatic page-marker detection; if found, pre-fill Paper View ranges
    // by mapping each detected marker's char range onto block indices, and default
    // to Paper View so the user reviews the auto-detected boundaries immediately.
    const detected = detectPageMarkers(fullText);
    const blockList = splitIntoBlocks(fullText);
    if (detected.length > 0 && blockList.length > 0) {
      const findBlockIndex = (charIndex: number, preferStart: boolean) => {
        for (let i = 0; i < blockList.length; i++) {
          const b = blockList[i];
          if (charIndex >= b.start && charIndex < b.end) return i;
        }
        return preferStart ? 0 : blockList.length - 1;
      };

      const ranges: (({ startBlock: number; endBlock: number }) | null)[] = images.map(() => null);
      detected.forEach(marker => {
        const pageIdx = marker.pageNumber - 1; // pageNumber is 1-based
        if (pageIdx < 0 || pageIdx >= images.length) return;
        if (marker.text.trim().length === 0) return;
        const startBlock = findBlockIndex(marker.startIndex, true);
        const endBlock = findBlockIndex(Math.max(marker.startIndex, marker.endIndex - 1), false);
        ranges[pageIdx] = { startBlock, endBlock };
      });
      setPageRanges(ranges);

      // Also seed the pairings textareas with the auto-detected text so list view and
      // paper view stay in sync until the user edits either.
      setPairings(prev => prev.map((p, idx) => {
        const marker = detected.find(m => m.pageNumber - 1 === idx);
        return marker ? marker.text : p;
      }));
      setViewMode('paper');
    } else {
      setPageRanges(images.map(() => null));
      setViewMode('list');
    }

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
        startPairing(parseTranslationDocText(result.value, pageBreakMarker), result.value);
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
    startPairing(parseTranslationDocText(text, pageBreakMarker), text);
  };

  const handlePasteConfirm = () => {
    if (!pasteText.trim()) return;
    startPairing(parseTranslationDocText(pasteText, pageBreakMarker), pasteText);
  };

  const updatePairing = (index: number, value: string) => {
    setPairings(prev => prev.map((p, i) => (i === index ? value : p)));
  };

  const clearPairing = (index: number) => {
    setPairings(prev => prev.map((p, i) => (i === index ? null : p)));
    setPageRanges(prev => prev.map((r, i) => (i === index ? null : r)));
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

  // Paper View click-to-mark: clicking a block sets the "start" pointer if there is none
  // yet (or resets after a range is already complete), then a second click sets "end".
  // The exact concatenated block text between start/end (inclusive) becomes this page's
  // reference text and is written into `pairings` via the same mechanism list view uses.
  const handleBlockClick = (blockIdx: number) => {
    const current = pageRanges[activePageIdx];
    let nextRange: { startBlock: number; endBlock: number };

    if (!current || current.endBlock !== -1) {
      // No range yet, or a complete range already exists — start a fresh one.
      nextRange = { startBlock: blockIdx, endBlock: -1 };
    } else {
      // Have a start pointer, this click sets the end pointer.
      const start = Math.min(current.startBlock, blockIdx);
      const end = Math.max(current.startBlock, blockIdx);
      nextRange = { startBlock: start, endBlock: end };
    }

    setPageRanges(prev => prev.map((r, i) => (i === activePageIdx ? nextRange : r)));

    if (nextRange.endBlock !== -1) {
      const text = blocks.slice(nextRange.startBlock, nextRange.endBlock + 1).map(b => b.text).join('\n\n').trim();
      setPairings(prev => prev.map((p, i) => (i === activePageIdx ? text : p)));
    }
  };

  const handleConfirm = () => {
    const result = images
      .map((img, idx) => ({ imageId: img.id, hint: (pairings[idx] || '').trim() }))
      .filter(p => p.hint.length > 0);
    onConfirm(result);
  };

  const extraParagraphsCount = Math.max(0, paragraphs.length - images.length);

  // Given a block index, returns the page index (if any) whose range covers it, for
  // rendering highlights across all detected/marked pages at once in Paper View.
  const blockPageIndex = (blockIdx: number): number | null => {
    for (let i = 0; i < pageRanges.length; i++) {
      const r = pageRanges[i];
      if (!r || r.endBlock === -1) continue;
      if (blockIdx >= r.startBlock && blockIdx <= r.endBlock) return i;
    }
    return null;
  };

  const highlightPalette = [
    'bg-sky-200/70', 'bg-amber-200/70', 'bg-emerald-200/70', 'bg-pink-200/70',
    'bg-violet-200/70', 'bg-orange-200/70', 'bg-teal-200/70', 'bg-rose-200/70',
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in text-left" dir="ltr">
      <div className="liquid-glass p-8 rounded-3xl max-w-5xl w-full mx-4 shadow-[0_20px_50px_rgba(56,189,248,0.3)] border border-sky-500/25 relative text-slate-200 flex flex-col gap-5 max-h-[90vh]">
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
              : 'Review and adjust the pairing between pages and translated text, then confirm.'}
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
                Documents with "pg1" / "page 2" / "#3"-style markers are auto-detected in the next step regardless of this setting.
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
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-[#111] text-slate-400 hover:text-white'}`}
              >
                <List size={14} /> List View
              </button>
              <button
                onClick={() => setViewMode('paper')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'paper' ? 'bg-blue-600 text-white' : 'bg-[#111] text-slate-400 hover:text-white'}`}
              >
                <BookOpen size={14} /> Paper View
              </button>
              {extraParagraphsCount > 0 && viewMode === 'list' && (
                <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 ml-auto">
                  {extraParagraphsCount} extra paragraph(s) beyond the number of pages were dropped.
                </p>
              )}
            </div>

            {viewMode === 'list' && (
              <div className="flex flex-col gap-3 overflow-y-auto pr-1">
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
            )}

            {viewMode === 'paper' && (
              <div className="flex flex-col sm:flex-row gap-4 overflow-hidden flex-1 min-h-0">
                {/* Compact page-thumbnail strip: click a page to select it as the active
                    target for the next start/end click in the paper text. */}
                <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-y-auto sm:w-24 shrink-0 pb-1 sm:pb-0 sm:pr-1">
                  {images.map((img, idx) => {
                    const hasRange = pageRanges[idx] && pageRanges[idx]!.endBlock !== -1;
                    return (
                      <button
                        key={img.id}
                        onClick={() => setActivePageIdx(idx)}
                        className={`relative flex flex-col items-center gap-1 shrink-0 rounded-lg p-1 border transition-colors ${
                          idx === activePageIdx ? 'border-sky-400 bg-sky-500/10' : 'border-sky-500/15 hover:border-sky-500/30'
                        }`}
                        title={`Mark boundaries for ${img.filename}`}
                      >
                        <img src={img.dataUrl} alt={img.filename} className="w-16 h-16 object-cover rounded-md" />
                        <span className="text-[9px] text-slate-400">Pg {idx + 1}</span>
                        {hasRange && (
                          <span className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ${highlightPalette[idx % highlightPalette.length].replace('/70', '')}`} />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 flex flex-col gap-2 min-h-0">
                  <p className="text-[11px] text-slate-400 shrink-0">
                    Marking text for <span className="text-sky-300 font-medium">Page {activePageIdx + 1}</span> ({images[activePageIdx]?.filename}).
                    Click a paragraph to set the start point, then click another to set the end point. Click the highlighted page dot on the strip to re-select and adjust.
                  </p>
                  <div className="flex-1 overflow-y-auto rounded-lg bg-slate-700/30 p-4 sm:p-8">
                    <div
                      className="mx-auto max-w-[210mm] min-h-[100px] bg-[#f8f4ec] text-[#1a1a1a] rounded-sm shadow-2xl px-6 py-8 sm:px-12 sm:py-10 font-serif leading-relaxed text-[13px] sm:text-sm"
                      dir="auto"
                    >
                      {blocks.length === 0 && (
                        <p className="text-slate-500 italic">No text found in the uploaded document.</p>
                      )}
                      {blocks.map((block, idx) => {
                        const owningPage = blockPageIndex(idx);
                        const isActiveRangeStart = pageRanges[activePageIdx]?.startBlock === idx && pageRanges[activePageIdx]?.endBlock === -1;
                        const colorClass = owningPage !== null ? highlightPalette[owningPage % highlightPalette.length] : '';
                        return (
                          <p
                            key={idx}
                            onClick={() => handleBlockClick(idx)}
                            className={`cursor-pointer whitespace-pre-wrap mb-3 px-1.5 py-1 rounded transition-colors hover:bg-sky-200/40 ${colorClass} ${
                              isActiveRangeStart ? 'ring-2 ring-sky-500' : ''
                            }`}
                            title={owningPage !== null ? `Assigned to page ${owningPage + 1}` : 'Click to assign to the selected page'}
                          >
                            {block.text}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

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
