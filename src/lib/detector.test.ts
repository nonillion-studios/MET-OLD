import { describe, it, expect } from 'vitest';
import { resolveBubblePolygon, pairBubbleAndTextDetections, DetectorDetection } from './detector';

// Minimal ImageData stand-in - only used as a flood-fill fallback when a detection has no
// polygon/mask, which none of these tests exercise (every detection below carries a
// polygon), but resolveBubblePolygon's signature requires one.
function makeImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { width, height, data, colorSpace: 'srgb' } as unknown as ImageData;
}

function rectPolygon(x1: number, y1: number, x2: number, y2: number) {
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

function bubbleDetection(x1: number, y1: number, x2: number, y2: number): DetectorDetection {
  return {
    class_name: 'bubble',
    confidence: 0.9,
    bbox: { x1, y1, x2, y2 },
    polygon: rectPolygon(x1, y1, x2, y2),
  };
}

function textDetection(x1: number, y1: number, x2: number, y2: number): DetectorDetection {
  return {
    class_name: 'text',
    confidence: 0.9,
    bbox: { x1, y1, x2, y2 },
    polygon: rectPolygon(x1, y1, x2, y2),
  };
}

const imageData = makeImageData(2000, 2000);

describe('pairBubbleAndTextDetections', () => {
  it('pairs a bubble with the text detection sitting inside it', () => {
    const bubble = bubbleDetection(100, 100, 300, 300);
    const text = textDetection(150, 150, 250, 200);
    const pairs = pairBubbleAndTextDetections([bubble, text]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].primary).toBe(bubble);
    expect(pairs[0].centerFrom).toBe(text);
  });

  it('leaves an unpaired text detection as its own entry using its own geometry', () => {
    const text = textDetection(400, 400, 500, 450);
    const pairs = pairBubbleAndTextDetections([text]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].primary).toBe(text);
    expect(pairs[0].centerFrom).toBeUndefined();
  });

  it('produces two distinct pairs for two adjacent/overlapping bubbles, each with its own text', () => {
    // Two touching bubbles side by side, each with its own text detection near its own
    // side - the "2 connected bubbles" scenario from the bug report.
    const bubbleA = bubbleDetection(0, 0, 220, 200);
    const textA = textDetection(20, 60, 100, 140);
    const bubbleB = bubbleDetection(200, 0, 420, 200);
    const textB = textDetection(320, 60, 400, 140);

    const pairs = pairBubbleAndTextDetections([bubbleA, textA, bubbleB, textB]);

    expect(pairs).toHaveLength(2);
    expect(pairs[0].primary).toBe(bubbleA);
    expect(pairs[0].centerFrom).toBe(textA);
    expect(pairs[1].primary).toBe(bubbleB);
    expect(pairs[1].centerFrom).toBe(textB);
  });

  it('does not pair a text detection that only barely overlaps a bubble', () => {
    const bubble = bubbleDetection(0, 0, 100, 100);
    // Mostly outside the bubble - only a sliver overlaps.
    const text = textDetection(90, 90, 200, 200);
    const pairs = pairBubbleAndTextDetections([bubble, text]);

    expect(pairs).toHaveLength(2);
    const bubbleEntry = pairs.find(p => p.primary === bubble);
    expect(bubbleEntry?.centerFrom).toBeUndefined();
    expect(pairs.some(p => p.primary === text)).toBe(true);
  });
});

describe('resolveBubblePolygon with centerFrom', () => {
  it('uses the bubble geometry for size and the paired text geometry for center', () => {
    const bubble = bubbleDetection(100, 100, 300, 300); // 200x200, center (200, 200)
    const text = textDetection(150, 150, 190, 170); // center (170, 160)

    const bubbleOnly = resolveBubblePolygon(bubble, imageData);
    const paired = resolveBubblePolygon(bubble, imageData, text);

    expect(bubbleOnly).not.toBeNull();
    expect(paired).not.toBeNull();

    // Size is unchanged - comes from the bubble alone.
    expect(paired!.width).toBeCloseTo(bubbleOnly!.width, 5);
    expect(paired!.height).toBeCloseTo(bubbleOnly!.height, 5);

    // Center now matches the text detection's bbox center, not the bubble's own centroid.
    const pairedCenterX = paired!.x + paired!.width / 2;
    const pairedCenterY = paired!.y + paired!.height / 2;
    expect(pairedCenterX).toBeCloseTo(170, 5);
    expect(pairedCenterY).toBeCloseTo(160, 5);

    // The bubble-only geometry, by contrast, stays centered on the bubble itself.
    const bubbleOnlyCenterX = bubbleOnly!.x + bubbleOnly!.width / 2;
    const bubbleOnlyCenterY = bubbleOnly!.y + bubbleOnly!.height / 2;
    expect(bubbleOnlyCenterX).toBeCloseTo(200, 5);
    expect(bubbleOnlyCenterY).toBeCloseTo(200, 5);
  });

  it('two connected bubbles each paired with their own text produce two distinct, correctly-centered regions', () => {
    const bubbleA = bubbleDetection(0, 0, 220, 200);
    const textA = textDetection(20, 60, 100, 140); // center (60, 100)
    const bubbleB = bubbleDetection(200, 0, 420, 200);
    const textB = textDetection(320, 60, 400, 140); // center (360, 100)

    const geomA = resolveBubblePolygon(bubbleA, imageData, textA)!;
    const geomB = resolveBubblePolygon(bubbleB, imageData, textB)!;

    const centerA = { x: geomA.x + geomA.width / 2, y: geomA.y + geomA.height / 2 };
    const centerB = { x: geomB.x + geomB.width / 2, y: geomB.y + geomB.height / 2 };

    expect(centerA.x).toBeCloseTo(60, 5);
    expect(centerB.x).toBeCloseTo(360, 5);
    // Distinct, non-overlapping centers - the two bubbles were not merged/confused.
    expect(Math.abs(centerA.x - centerB.x)).toBeGreaterThan(100);
  });

  it('a lone unpaired text detection uses its own geometry for both center and size', () => {
    const text = textDetection(400, 400, 500, 450);
    const geom = resolveBubblePolygon(text, imageData);

    expect(geom).not.toBeNull();
    expect(geom!.width).toBeCloseTo(100, 5);
    expect(geom!.height).toBeCloseTo(50, 5);
    expect(geom!.x).toBeCloseTo(400, 5);
    expect(geom!.y).toBeCloseTo(400, 5);
  });
});
