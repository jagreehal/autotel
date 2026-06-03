import { describe, it, expect } from 'vitest';
import { clampScale, zoomAbout, fitToBounds } from './zoomPan.svelte';

describe('clampScale', () => {
  it('clamps to the [min, max] range', () => {
    expect(clampScale(1, 0.2, 3)).toBe(1);
    expect(clampScale(0.05, 0.2, 3)).toBe(0.2);
    expect(clampScale(10, 0.2, 3)).toBe(3);
  });
});

describe('zoomAbout', () => {
  const at1 = { scale: 1, translate: { x: 0, y: 0 } };

  it('keeps the anchored point fixed on screen as scale changes', () => {
    const anchor = { x: 100, y: 100 };
    const next = zoomAbout(at1, 2, anchor, 0.2, 3);
    expect(next.scale).toBe(2);
    // The world point under the anchor must map back to the same screen point.
    const worldX = (anchor.x - at1.translate.x) / at1.scale;
    expect(worldX * next.scale + next.translate.x).toBe(anchor.x);
  });

  it('returns the current transform unchanged when the clamp pins the scale', () => {
    const at3 = { scale: 3, translate: { x: 5, y: 5 } };
    expect(zoomAbout(at3, 9, { x: 0, y: 0 }, 0.2, 3)).toBe(at3);
  });
});

describe('fitToBounds', () => {
  it('scales and centres the content within the padded view', () => {
    const t = fitToBounds(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      240,
      240,
      20,
      0.2,
      3,
    );
    expect(t.scale).toBe(2); // (240 - 40) / 100
    expect(t.translate).toEqual({ x: 20, y: 20 });
  });

  it('never exceeds the max scale for tiny content', () => {
    const t = fitToBounds(
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      1000,
      1000,
      0,
      0.2,
      3,
    );
    expect(t.scale).toBe(3);
  });
});
