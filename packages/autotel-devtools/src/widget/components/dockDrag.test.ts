import { describe, it, expect } from 'vitest';
import { nearestEdge } from './dockDrag.svelte';

describe('nearestEdge', () => {
  const W = 1000;
  const H = 600;

  it('picks the closest viewport edge to the point', () => {
    expect(nearestEdge(10, 300, W, H)).toBe('left');
    expect(nearestEdge(990, 300, W, H)).toBe('right');
    expect(nearestEdge(500, 5, W, H)).toBe('top');
    expect(nearestEdge(500, 595, W, H)).toBe('bottom');
  });

  it('breaks ties deterministically by declaration order', () => {
    // Dead centre: left/right tie at 500, top/bottom tie at 300 — the 300s win,
    // and reduce keeps the earliest-declared of those (top before bottom).
    expect(nearestEdge(500, 300, W, H)).toBe('top');
  });
});
