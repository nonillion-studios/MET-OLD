import React, { useState, useRef } from 'react';
import { Upload, Sparkles, ImagePlus, ChevronUp, ChevronDown, Trash2, Scissors, X, Plus } from 'lucide-react';
import { ProcessedImage } from '../types';
import { isLongPage, getImageDataFromDataUrl, computeSplitPlan, splitImageByRows } from '../lib/pageSplit';

interface UploadReviewModalProps {
  images: ProcessedImage[];
  setImages: React.Dispatch<React.SetStateAction<ProcessedImage[]>>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  cleanZipInputRef: React.RefObject<HTMLInputElement>;
  appendImagesInputRef: React.RefObject<HTMLInputElement>;
  zipMatchMode: 'filename' | 'index';
  setZipMatchMode: (m: 'filename' | 'index') => void;
  moveImageUp: (index: number) => void;
  moveImageDown: (index: number) => void;
  deleteImage: (id: string, event: React.MouseEvent) => void;
  onClose: () => void;
}

interface SplitEditorProps {
  img: ProcessedImage;
  initialCutRows: number[];
  onApply: (cutRows: number[]) => void;
  onCancel: () => void;
}

/** Inline manual cut editor: full page thumbnail with draggable/removable horizontal cut lines. */
function SplitEditor({ img, initialCutRows, onApply, onCancel }: SplitEditorProps) {
  const [cutRows, setCutRows] = useState<number[]>(initialCutRows);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingIndex = useRef<number | null>(null);

  const clampRow = (y: number) => Math.min(Math.max(Math.round(y), 1), img.height - 1);

  const rowToPercent = (row: number) => (row / img.height) * 100;

  const yToRow = (clientY: number): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    const fraction = (clientY - rect.top) / rect.height;
    return clampRow(fraction * img.height);
  };

  const handlePointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingIndex.current = index;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingIndex.current === null) return;
    const idx = draggingIndex.current;
    const row = yToRow(e.clientY);
    setCutRows(prev => {
      const next = [...prev];
      next[idx] = row;
      return next;
    });
  };

  const endDrag = () => {
    if (draggingIndex.current === null) return;
    draggingIndex.current = null;
    // Re-sort so drag order can't create out-of-order cuts
    setCutRows(prev => [...prev].sort((a, b) => a - b));
  };

  const addCut = () => {
    const bounds = [0, ...[...cutRows].sort((a, b) => a - b), img.height];
    let bestGapStart = 0;
    let bestGapSize = -1;
    for (let i = 0; i < bounds.length - 1; i++) {
      const size = bounds[i + 1] - bounds[i];
      if (size > bestGapSize) {
        bestGapSize = size;
        bestGapStart = bounds[i];
      }
    }
    const newRow = clampRow(bestGapStart + bestGapSize / 2);
    setCutRows(prev => [...prev, newRow].sort((a, b) => a - b));
  };

  const removeCut = (index: number) => {
    setCutRows(prev => prev.filter((_, i) => i !== index));
  };

  const sortedCuts = [...cutRows].sort((a, b) => a - b);

  return (
    <div className="mt-1 p-2 rounded-lg bg-purple-950/30 border border-purple-500/20 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-purple-300 flex items-center gap-1">
          <Scissors size={10} /> {sortedCuts.length + 1} pieces
        </span>
        <button onClick={addCut} className="text-[9px] bg-purple-700 hover:bg-purple-600 text-white rounded px-1.5 py-0.5 flex items-center gap-0.5">
          <Plus size={10} /> Add Cut
        </button>
      </div>

      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative w-full select-none touch-none rounded overflow-hidden border border-purple-500/20"
        style={{ aspectRatio: `${img.width} / ${img.height}` }}
      >
        <img src={img.dataUrl} alt={img.filename} className="w-full h-full object-cover pointer-events-none" draggable={false} />
        {sortedCuts.map((row, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 flex items-center group"
            style={{ top: `${rowToPercent(row)}%`, transform: 'translateY(-50%)', cursor: 'ns-resize' }}
            onPointerDown={handlePointerDown(i)}
          >
            <div className="h-[3px] flex-1 bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.9)]" />
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); removeCut(i); }}
              className="ml-1 bg-red-700 hover:bg-red-600 text-white rounded-full p-0.5 shrink-0"
              title="Remove cut"
            >
              <X size={9} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-1">
        <button onClick={() => onApply(sortedCuts)} className="flex-1 text-[9px] bg-emerald-700 hover:bg-emerald-600 text-white rounded py-1">Apply Split</button>
        <button onClick={onCancel} className="flex-1 text-[9px] bg-[#222] hover:bg-[#333] text-white rounded py-1">Cancel</button>
      </div>
    </div>
  );
}

export function UploadReviewModal({
  images,
  setImages,
  fileInputRef,
  cleanZipInputRef,
  appendImagesInputRef,
  zipMatchMode,
  setZipMatchMode,
  moveImageUp,
  moveImageDown,
  deleteImage,
  onClose
}: UploadReviewModalProps) {
  const [step, setStep] = useState<'upload' | 'review'>(images.length > 0 ? 'review' : 'upload');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInitialCuts, setEditInitialCuts] = useState<number[]>([]);
  const [computingId, setComputingId] = useState<string | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  const goToReview = () => setStep('review');

  const openSplitEditor = async (img: ProcessedImage) => {
    setComputingId(img.id);
    try {
      // Use the auto-detect algorithm purely as a starting suggestion; user can
      // freely add/drag/remove cuts afterward.
      const imageData = await getImageDataFromDataUrl(img.dataUrl, img.width, img.height);
      const plan = computeSplitPlan(imageData, img.width, img.height);
      setEditInitialCuts(plan.cutRows);
    } catch (e) {
      console.error('Split suggestion failed, defaulting to midpoint', e);
      setEditInitialCuts([Math.round(img.height / 2)]);
    } finally {
      setComputingId(null);
      setSkippedIds(prev => {
        const next = new Set(prev);
        next.delete(img.id);
        return next;
      });
      setEditingId(img.id);
    }
  };

  const applySplit = async (img: ProcessedImage, cutRows: number[]) => {
    const pieces = await splitImageByRows(img.dataUrl, img.width, img.height, img.mimeType, cutRows);
    const groupId = 'split-' + Math.random().toString(36).substr(2, 9);
    const newEntries: ProcessedImage[] = pieces.map((piece, idx) => ({
      id: Math.random().toString(36).substr(2, 9),
      filename: img.filename.replace(/(\.[^.]+)$/, `-part${idx + 1}$1`),
      dataUrl: piece.dataUrl,
      mimeType: img.mimeType,
      regions: [],
      paintStrokes: [],
      status: 'idle',
      width: piece.width,
      height: piece.height,
      splitGroupId: groupId,
      splitIndex: idx
    }));

    setImages(prev => {
      const idx = prev.findIndex(p => p.id === img.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, ...newEntries);
      return next;
    });
    setEditingId(null);
  };

  const cancelSplitEditor = (imgId: string) => {
    setEditingId(null);
    setSkippedIds(prev => new Set(prev).add(imgId));
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="liquid-glass p-6 sm:p-8 rounded-3xl max-w-3xl w-full mx-4 shadow-[0_20px_50px_rgba(56,189,248,0.3)] border border-sky-500/25 relative text-slate-100 flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all text-sm font-bold"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col gap-1.5 text-left">
          <h2 className="text-2xl font-display font-bold text-white flex items-center gap-2">
            <span className="text-sky-400">✧</span> {step === 'upload' ? 'Upload Pages' : 'Review Pages'}
          </h2>
          <p className="text-xs text-slate-400 leading-normal">
            {step === 'upload'
              ? 'Import raw pages and, optionally, a matching cleaned/inpainted plate set.'
              : 'Reorder, delete, or split pages before continuing.'}
          </p>
        </div>

        {step === 'upload' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-5 rounded-2xl bg-[#080512]/60 hover:bg-blue-950/20 border border-sky-500/15 hover:border-sky-500/45 transition-all flex flex-col gap-2.5 text-left group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center border border-sky-500/20 text-sky-400">
                  <Upload size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white group-hover:text-sky-300">Upload ZIP Chapter</h4>
                  <p className="text-[11px] text-slate-400 mt-1">Raw comic image files inside any ZIP.</p>
                </div>
              </button>

              <button
                onClick={() => cleanZipInputRef.current?.click()}
                className="p-5 rounded-2xl bg-[#080512]/60 hover:bg-blue-950/20 border border-sky-500/15 hover:border-sky-500/40 transition-all flex flex-col gap-2.5 text-left group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 text-sky-400">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white group-hover:text-sky-300">Cleaned Plates ZIP</h4>
                  <p className="text-[11px] text-slate-400 mt-1">Superimpose text on white-cleaned pages.</p>
                </div>
              </button>

              <button
                onClick={() => appendImagesInputRef.current?.click()}
                className="p-5 rounded-2xl bg-[#080512]/60 hover:bg-blue-950/20 border border-sky-500/15 hover:border-sky-500/40 transition-all flex flex-col gap-2.5 text-left group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center border border-sky-500/20 text-sky-400">
                  <ImagePlus size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white group-hover:text-sky-300">Add Raw Pages</h4>
                  <p className="text-[11px] text-slate-400 mt-1">Select and append individual image files.</p>
                </div>
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>Cleaned ZIP match mode:</span>
              <select
                value={zipMatchMode}
                onChange={(e) => setZipMatchMode(e.target.value as 'filename' | 'index')}
                className="bg-black/60 border border-sky-500/20 rounded-lg px-2 py-1 text-slate-200"
              >
                <option value="filename">Match by filename</option>
                <option value="index">Match by page order</option>
              </select>
            </div>

            <div className="flex justify-end border-t border-sky-500/10 pt-4">
              <button
                onClick={goToReview}
                disabled={images.length === 0}
                className="bg-gradient-to-r from-blue-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2.5 px-7 rounded-xl text-xs transition-all shadow-lg shadow-blue-950/45 cursor-pointer"
              >
                Continue to Review ({images.length} pages) →
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">{images.length} pages</span>
              <button
                onClick={() => setStep('upload')}
                className="flex items-center gap-2 bg-[#111] hover:bg-[#222] px-3 py-1.5 rounded-md text-xs text-slate-300"
              >
                <ImagePlus size={14} /> Add more pages
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {images.map((img, i) => {
                const long = isLongPage(img.width, img.height);
                const isEditing = editingId === img.id;
                const isSkipped = skippedIds.has(img.id);
                return (
                  <div key={img.id} className="relative flex flex-col gap-1.5 p-2 rounded-xl bg-[#0b0819] border border-sky-500/10">
                    <div className="relative aspect-[3/4] w-full bg-black rounded overflow-hidden">
                      <img src={img.dataUrl} alt={img.filename} className="w-full h-full object-cover opacity-90" />
                      {img.originalDataUrl && (
                        <span className="absolute top-1.5 left-1.5 bg-sky-600 text-white text-[9px] uppercase font-bold px-1.5 py-0.5 rounded">Cleaned</span>
                      )}
                      {img.splitGroupId && (
                        <span className="absolute top-1.5 right-1.5 bg-purple-600 text-white text-[9px] uppercase font-bold px-1.5 py-0.5 rounded">
                          Part {(img.splitIndex ?? 0) + 1}
                        </span>
                      )}
                    </div>

                    <span className="text-[10px] truncate text-slate-300" title={img.filename}>{img.filename}</span>

                    <div className="flex items-center justify-between gap-1">
                      <div className="flex gap-1">
                        <button onClick={() => moveImageUp(i)} className="bg-black/80 hover:bg-[#222] text-white p-1 rounded" title="Move Up">
                          <ChevronUp size={12} />
                        </button>
                        <button onClick={() => moveImageDown(i)} className="bg-black/80 hover:bg-[#222] text-white p-1 rounded" title="Move Down">
                          <ChevronDown size={12} />
                        </button>
                      </div>
                      <button onClick={(e) => deleteImage(img.id, e)} className="bg-red-900/80 hover:bg-red-700 text-white p-1 rounded" title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {long && !img.splitGroupId && !isEditing && (
                      <div className="mt-1 p-1.5 rounded-lg bg-purple-950/30 border border-purple-500/20 flex flex-col gap-1.5">
                        <span className="text-[9px] text-purple-300 flex items-center gap-1">
                          <Scissors size={10} /> Long page detected
                        </span>
                        <button
                          onClick={() => openSplitEditor(img)}
                          disabled={computingId === img.id}
                          className="text-[9px] bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded py-1"
                        >
                          {computingId === img.id ? 'Analyzing…' : 'Preview Split'}
                        </button>
                        {isSkipped && <span className="text-[9px] text-slate-500">Split skipped</span>}
                      </div>
                    )}

                    {isEditing && (
                      <SplitEditor
                        img={img}
                        initialCutRows={editInitialCuts}
                        onApply={(cutRows) => applySplit(img, cutRows)}
                        onCancel={() => cancelSplitEditor(img.id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between border-t border-sky-500/10 pt-4">
              <button
                onClick={() => setStep('upload')}
                className="bg-black/60 hover:bg-black border border-sky-500/15 hover:border-sky-500/30 text-slate-300 font-bold py-2.5 px-6 rounded-xl text-xs transition-all cursor-pointer"
              >
                ← Back
              </button>
              <button
                onClick={onClose}
                className="bg-gradient-to-r from-blue-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold py-2.5 px-7 rounded-xl text-xs transition-all shadow-lg shadow-blue-950/45 cursor-pointer"
              >
                ✓ Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
