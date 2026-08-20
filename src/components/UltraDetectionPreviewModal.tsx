import React, { useState } from 'react';

interface UltraDetectionPreviewModalProps {
  annotatedImage: string;
  detectionCount: number;
  initialConfidence: number;
  onRedetect: (confidence: number) => Promise<{ annotatedImage: string; detectionCount: number }>;
  onContinue: () => void;
  onCancel: () => void;
}

// Shown between Ultra Mode's detection phase and its AI-translation phase when
// auto-accept is off: lets the user preview the numbered-marker detections, adjust the
// confidence threshold and re-run detection, then either continue to the AI or cancel.
export function UltraDetectionPreviewModal({
  annotatedImage,
  detectionCount,
  initialConfidence,
  onRedetect,
  onContinue,
  onCancel,
}: UltraDetectionPreviewModalProps) {
  const [confidence, setConfidence] = useState(initialConfidence);
  const [image, setImage] = useState(annotatedImage);
  const [count, setCount] = useState(detectionCount);
  const [redetecting, setRedetecting] = useState(false);

  const handleRedetect = async () => {
    setRedetecting(true);
    try {
      const result = await onRedetect(confidence);
      setImage(result.annotatedImage);
      setCount(result.detectionCount);
    } finally {
      setRedetecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="liquid-glass w-full max-w-2xl max-h-[90vh] rounded-2xl border border-sky-500/15 flex flex-col overflow-hidden">
        <div className="p-5 border-b border-sky-500/10 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white font-display">Detection Preview</h3>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">{count} region{count === 1 ? '' : 's'} detected. Review before sending to the AI.</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div className="rounded-xl overflow-hidden border border-sky-500/15 bg-black/40">
            <img src={image} alt="Detection preview" className="w-full h-auto block" />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] text-slate-400 font-mono flex justify-between">
              <span>Detection Confidence</span>
              <span className="text-sky-400">{confidence.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={confidence}
              onChange={(e) => setConfidence(parseFloat(e.target.value))}
              className="w-full accent-sky-500"
            />
            <button
              onClick={handleRedetect}
              disabled={redetecting}
              className="w-full py-2 rounded-xl text-sm font-mono border border-sky-500/20 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-slate-200 transition-colors"
            >
              {redetecting ? 'Re-detecting...' : 'Re-detect'}
            </button>
          </div>
        </div>

        <div className="p-5 border-t border-sky-500/10 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-mono border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onContinue}
            disabled={redetecting}
            className="flex-1 py-2.5 rounded-xl text-sm font-mono bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white transition-colors"
          >
            Continue to AI
          </button>
        </div>
      </div>
    </div>
  );
}
