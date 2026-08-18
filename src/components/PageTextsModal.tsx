import React from 'react';
import { Region } from '../types';

interface PageTextsModalProps {
  regions: Region[];
  onClose: () => void;
  onSelectRegion: (id: string) => void;
}

export function PageTextsModal({ regions, onClose, onSelectRegion }: PageTextsModalProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in text-left" dir="ltr">
      <div className="liquid-glass p-8 rounded-3xl max-w-lg w-full mx-4 shadow-[0_20px_50px_rgba(56,189,248,0.3)] border border-sky-500/25 relative text-slate-200 flex flex-col gap-5 max-h-[80vh]">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all text-sm font-bold"
        >
          ✕
        </button>

        <div className="flex flex-col gap-1.5 text-left border-b border-sky-500/10 pb-4">
          <h2 className="text-2xl font-display font-bold text-white flex items-center gap-2 justify-start">
            <span className="text-sky-400">✧</span> All Texts in Page
          </h2>
          <p className="text-xs text-slate-400">
            Click any text below to jump straight to its region on the canvas.
          </p>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {regions.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">No text regions on this page yet.</p>
          ) : (
            regions.map((region, idx) => (
              <button
                key={region.id}
                onClick={() => onSelectRegion(region.id)}
                className="text-left w-full bg-blue-950/25 hover:bg-blue-950/50 border border-sky-500/15 hover:border-sky-500/40 rounded-xl p-3 transition-all"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] bg-[#111] px-1.5 py-0.5 rounded uppercase tracking-wider text-slate-400">
                    #{idx + 1} · {region.type}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-1">{region.originalText}</p>
                <p className="text-sm text-slate-200">{region.translatedText}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
