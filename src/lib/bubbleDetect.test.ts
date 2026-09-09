import { describe, it, expect } from 'vitest';
import { floodFillBubbleDetailed } from './bubbleDetect';

// Minimal ImageData stand-in: floodFillBubbleDetailed only reads width/height/data, so a
// plain object is enough - no DOM/canvas needed to test the pure pixel-walking logic.
function makeImageData(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as unknown as ImageData;
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe('floodFillBubbleDetailed', () => {
  it('returns null for a start point outside the image bounds', () => {
    const imageData = makeImageData(20, 20, () => WHITE);
    expect(floodFillBubbleDetailed(imageData, -1, 5)).toBeNull();
    expect(floodFillBubbleDetailed(imageData, 5, 20)).toBeNull();
  });

  it('finds the bubble interior when the start point sits on a light background', () => {
    // A 20x20 solid white square on a black page - simplest possible bubble.
    const imageData = makeImageData(40, 40, (x, y) => {
      const inSquare = x >= 10 && x < 30 && y >= 10 && y < 30;
      return inSquare ? WHITE : BLACK;
    });

    const result = floodFillBubbleDetailed(imageData, 20, 20, 20, 20);
    expect(result).not.toBeNull();
    expect(result!.safeTextBounds.width).toBeGreaterThan(0);
    expect(result!.safeTextBounds.height).toBeGreaterThan(0);
  });

  it('does not leak the safe text bounds past a black bubble border onto a white page behind it', () => {
    // Regression test: the safe-bounds distance walk must stop at the bubble's black
    // border and must NOT continue into a white page background beyond it. Before the
    // interior/visited split fix, the walk used the flood-fill `visited` mask (which also
    // marks the border ring as "visited") instead of a mask of confirmed-interior pixels,
    // so it could walk straight through a 1-2px border into whatever white area lay
    // beyond the bubble - here, the rest of a whitened page.
    const size = 60;
    const borderInner = 15; // ring drawn from x/y in [15, 44]
    const borderOuter = 44;
    const ringThickness = 2;

    const imageData = makeImageData(size, size, (x, y) => {
      const onRing =
        x >= borderInner && x <= borderOuter && y >= borderInner && y <= borderOuter &&
        (x < borderInner + ringThickness || x > borderOuter - ringThickness ||
         y < borderInner + ringThickness || y > borderOuter - ringThickness);
      return onRing ? BLACK : WHITE; // everything else, inside AND outside the ring, is white
    });

    const result = floodFillBubbleDetailed(imageData, size / 2, size / 2, 30, 30);
    expect(result).not.toBeNull();

    // The bubble interior is roughly [17, 42] x [17, 42] (inside the 2px ring). The safe
    // bounds must stay comfortably inside that - well short of the full 60x60 canvas.
    const { x, y, width, height } = result!.safeTextBounds;
    expect(x).toBeGreaterThan(borderInner);
    expect(y).toBeGreaterThan(borderInner);
    expect(x + width).toBeLessThan(borderOuter);
    expect(y + height).toBeLessThan(borderOuter);
  });

  it('returns null when the start point is on a dark pixel with no nearby light area', () => {
    const imageData = makeImageData(30, 30, () => BLACK);
    expect(floodFillBubbleDetailed(imageData, 15, 15)).toBeNull();
  });
});
