import { describe, it, expect } from 'vitest';
import { placeCard } from './hoverCard.svelte';

// SAFETY: placeCard reads only top, bottom, left, width and height.
const rect = (top: number, bottom: number, left = 0, width = 1000) =>
  ({ top, bottom, left, width, height: bottom - top }) as DOMRect;

describe('placeCard', () => {
  it('opens below the cell when there is room', () => {
    expect(placeCard(rect(0, 800), rect(100, 120, 40))).toEqual({
      above: false,
      top: 120,
      left: 40,
    });
  });

  it('opens above when the room below is short and above is roomier', () => {
    expect(placeCard(rect(0, 800), rect(700, 720, 40))).toMatchObject({
      above: true,
      top: 700,
    });
  });

  it('stays below in a short container with no more room above', () => {
    expect(placeCard(rect(0, 100), rect(10, 30))).toMatchObject({
      above: false,
    });
  });

  it('sizes the room it needs to the card', () => {
    const tall = { width: 528, height: 360 };
    // 280px below fits the span card but not a 360px trace card.
    expect(placeCard(rect(0, 800), rect(500, 520)).above).toBe(false);
    expect(placeCard(rect(0, 800), rect(500, 520), tall).above).toBe(true);
    expect(placeCard(rect(0, 800, 0, 600), rect(0, 20, 500), tall).left).toBe(
      72,
    );
  });

  it('keeps the card inside the container width', () => {
    expect(placeCard(rect(0, 800, 0, 600), rect(0, 20, 500)).left).toBe(172);
  });
});
