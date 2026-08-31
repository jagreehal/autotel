import { describe, expect, it } from 'vitest';
import { sampleByKey } from './sampling';

describe('sampleByKey', () => {
  it('gives the same answer for the same key every time', () => {
    const first = sampleByKey('session-abc', 0.5);
    for (let i = 0; i < 20; i++) {
      expect(sampleByKey('session-abc', 0.5)).toBe(first);
    }
  });

  it('keeps everything at 1 and nothing at 0', () => {
    for (const key of ['a', 'b', 'c', 'd']) {
      expect(sampleByKey(key, 1)).toBe(true);
      expect(sampleByKey(key, 0)).toBe(false);
    }
  });

  it('clamps a rate outside 0..1', () => {
    expect(sampleByKey('a', 5)).toBe(true);
    expect(sampleByKey('a', -1)).toBe(false);
  });

  it('lands near the requested rate across many keys', () => {
    const keys = Array.from({ length: 4000 }, (_, i) => `session-${i}`);
    const kept = keys.filter((key) => sampleByKey(key, 0.25)).length;
    expect(kept / keys.length).toBeGreaterThan(0.2);
    expect(kept / keys.length).toBeLessThan(0.3);
  });

  it('is monotonic in the rate, so raising it never drops a kept key', () => {
    // The property that makes this usable: turn sampling up and you get a
    // superset, not a different set.
    const keys = Array.from({ length: 500 }, (_, i) => `s${i}`);
    for (const key of keys) {
      if (sampleByKey(key, 0.2)) expect(sampleByKey(key, 0.6)).toBe(true);
    }
  });
});
