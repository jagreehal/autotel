/**
 * Sampling that keeps whole sessions.
 *
 * Random per-event sampling at 10% gives you a tenth of every session — enough
 * to draw a chart, never enough to reconstruct what one person hit. Hashing a
 * stable key instead gives you all of a tenth of the sessions, which is the
 * one you can actually debug from.
 *
 * The decision is a pure function of the key, so it needs no coordination: two
 * tabs, the browser and the server, or two services on the same trace all reach
 * the same answer without talking to each other.
 */

/**
 * FNV-1a, 32-bit. Chosen because it is eight lines and spreads short,
 * similar-prefixed keys (`session-1`, `session-2`) evenly, which the classic
 * `hash * 31 + char` does not do well at this length.
 */
function hash(key: string): number {
  let value = 0x81_1c_9d_c5;
  for (let index = 0; index < key.length; index++) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 0x01_00_01_93);
  }
  return value >>> 0;
}

/**
 * Whether `key` is in the sampled `rate` (0..1, clamped).
 *
 * Monotonic in `rate`: raising it can only add keys, never swap them. That is
 * what makes turning sampling up mid-incident safe — the sessions you were
 * already watching stay in the set.
 */
export function sampleByKey(key: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  // 2^32 buckets rather than 100, so a rate of 0.001 is still expressible.
  return hash(key) < rate * 0x1_00_00_00_00;
}
