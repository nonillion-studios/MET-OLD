import { describe, it, expect } from 'vitest';
import { computeDetectionSafeSplitRows } from './autoSplit';
import { DetectorDetection } from './detector';

function bubble(y1: number, y2: number): DetectorDetection {
  return { class_name: 'bubble', confidence: 0.9, bbox: { x1: 0, y1, x2: 100, y2 } };
}

describe('computeDetectionSafeSplitRows', () => {
  it('never places a cut inside a detected bubble', () => {
    // A 6000px strip with bubbles clustered near the ideal 1/3 and 2/3 cut points -
    // the naive ideal lines would land right inside them.
    const detections = [bubble(1900, 2100), bubble(3900, 4100)];
    const cuts = computeDetectionSafeSplitRows(detections, 6000, 2000);

    for (const cut of cuts) {
      for (const d of detections) {
        expect(cut < d.bbox.y1 || cut > d.bbox.y2).toBe(true);
      }
    }
  });

  it('returns an empty array when detections cover the whole strip with no gaps', () => {
    const detections = [bubble(0, 3000), bubble(3000, 6000)];
    const cuts = computeDetectionSafeSplitRows(detections, 6000, 2000);
    expect(cuts).toEqual([]);
  });

  it('ignores panel-class detections when finding safe gaps', () => {
    // A single huge panel spanning almost the entire strip should not, by itself, block
    // every cut - only bubble/text/sfx are treated as unsafe.
    const detections: DetectorDetection[] = [
      { class_name: 'panel', confidence: 0.9, bbox: { x1: 0, y1: 0, x2: 100, y2: 5900 } },
    ];
    const cuts = computeDetectionSafeSplitRows(detections, 6000, 2000);
    expect(cuts.length).toBeGreaterThan(0);
  });

  it('produces roughly evenly spaced cuts on a strip with no detections at all', () => {
    const cuts = computeDetectionSafeSplitRows([], 6000, 2000);
    expect(cuts.length).toBe(2);
    expect(cuts[0]).toBeCloseTo(2000, -2);
    expect(cuts[1]).toBeCloseTo(4000, -2);
  });
});
