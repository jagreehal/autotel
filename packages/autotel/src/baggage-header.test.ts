import { describe, expect, it } from 'vitest';
import { planBatch } from './baggage-header';

const v = (n: number) => 'v'.repeat(n);

describe('planBatch', () => {
  // Past the exhaustive size, writes are added cheapest first. A shrink that
  // makes a too-long entry sendable costs its whole size, so it goes last.
  it('keeps the many small writes over one shrink that displaces baggage', () => {
    const initial = new Map([
      ['a', { value: v(5000) }], // too long: skipped
      ['x1', { value: v(4000) }],
      ['x2', { value: v(4000) }],
    ]);
    const tiny = Array.from({ length: 12 }, (_, i) => ({
      key: `t${i}`,
      fullKey: `t${i}`,
      entry: { value: 'x' },
    }));
    const shrink = { key: 'a', fullKey: 'a', entry: { value: v(3900) } };
    const { accepted, rejected } = planBatch(initial, [shrink, ...tiny], 8192);
    expect(accepted.map((w) => w.key).toSorted()).toEqual(
      tiny.map((w) => w.key).toSorted(),
    );
    expect(rejected).toEqual([shrink]);
  });

  // The claim in largestFitting's doc: adding cheapest first keeps as many
  // writes as trying every subset, whenever the inherited baggage fits.
  it('matches the exhaustive search when inherited baggage fits (500 seeded cases)', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return Math.floor((seed / 2_147_483_648) * n);
    };
    let compared = 0;
    for (let round = 0; round < 500; round++) {
      const initial = new Map(
        Array.from({ length: rand(8) }, () => [
          `k${rand(12)}`,
          { value: v(1 + rand(rand(3) === 0 ? 5000 : 2500)) },
        ]),
      );
      // Fits: every pair the propagator may send (4096 bytes or less) fits
      // in its 8192, so it is leaving nothing out yet.
      const sendable = [...initial]
        .map(([key, e]) => key.length + 1 + e.value.length)
        .filter((size) => size <= 4096);
      const sendableSize =
        Math.max(0, sendable.length - 1) + sendable.reduce((a, b) => a + b, 0);
      if (sendableSize > 8192) continue;
      const keys = [
        ...new Set(Array.from({ length: 1 + rand(9) }, () => `k${rand(12)}`)),
      ];
      const batch = keys.map((key) => ({
        key,
        fullKey: key,
        entry: { value: v(1 + rand(rand(2) === 0 ? 3000 : 200)) },
      }));
      const limit = [600, 4000, 8192][rand(3)]!;
      const exact = planBatch(initial, batch, limit, 12).accepted.length;
      const greedy = planBatch(initial, batch, limit, 0).accepted.length;
      expect(greedy).toBe(exact);
      compared++;
    }
    expect(compared).toBeGreaterThan(300);
  });
});
