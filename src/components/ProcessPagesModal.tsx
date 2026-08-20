import React, { useState } from 'react';
import { X, CheckSquare, Square, Play } from 'lucide-react';
import { ProcessedImage } from '../types';

interface ProcessPagesModalProps {
  images: ProcessedImage[];
  onClose: () => void;
  onStart: (imageIds: string[]) => void;
}

export function ProcessPagesModal({ images, onClose, onStart }: ProcessPagesModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(images.map(i => i.id)));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(images.map(i => i.id)));
  const selectNone = () => setSelected(new Set());

  const handleStart = () => {
    // Preserve page order, not selection order
    const orderedIds = images.filter(i => selected.has(i.id)).map(i => i.id);
    if (orderedIds.length === 0) return;
    onStart(orderedIds);
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
            <span className="text-sky-400">✧</span> Process Pages
          </h2>
          <p className="text-xs text-slate-400 leading-normal">
            Choose which pages to translate. Pages are processed one at a time, in order. Already-done pages can be reselected to reprocess them.
          </p>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-400">{selected.size} of {images.length} selected</span>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="flex items-center gap-1.5 bg-[#111] hover:bg-[#222] px-3 py-1.5 rounded-md text-xs text-slate-300"
            >
              <CheckSquare size={14} /> Select All
            </button>
            <button
              onClick={selectNone}
              className="flex items-center gap-1.5 bg-[#111] hover:bg-[#222] px-3 py-1.5 rounded-md text-xs text-slate-300"
            >
              <Square size={14} /> Select None
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {images.map(img => {
            const isSelected = selected.has(img.id);
            return (
              <button
                key={img.id}
                onClick={() => toggle(img.id)}
                className={`relative flex flex-col gap-1.5 p-2 rounded-xl border text-left transition-all ${isSelected ? 'bg-blue-950/40 border-sky-500/50' : 'bg-[#0b0819] border-sky-500/10 opacity-60 hover:opacity-90'}`}
              >
                <div className="relative aspect-[3/4] w-full bg-black rounded overflow-hidden">
                  <img src={img.dataUrl} alt={img.filename} className="w-full h-full object-cover" />
                  {img.status === 'done' && (
                    <span className="absolute top-1.5 left-1.5 bg-emerald-500 text-white text-[9px] uppercase font-bold px-1.5 py-0.5 rounded">Done</span>
                  )}
                  <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center border ${isSelected ? 'bg-sky-500 border-sky-400' : 'bg-black/60 border-slate-500'}`}>
                    {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                  </div>
                </div>
                <span className="text-[10px] truncate text-slate-300" title={img.filename}>{img.filename}</span>
              </button>
            );
          })}
        </div>

        <div className="flex justify-between border-t border-sky-500/10 pt-4">
          <button
            onClick={onClose}
            className="bg-black/60 hover:bg-black border border-sky-500/15 hover:border-sky-500/30 text-slate-300 font-bold py-2.5 px-6 rounded-xl text-xs transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={selected.size === 0}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2.5 px-7 rounded-xl text-xs transition-all shadow-lg shadow-blue-950/45 cursor-pointer"
          >
            <Play size={14} /> Start Processing ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
