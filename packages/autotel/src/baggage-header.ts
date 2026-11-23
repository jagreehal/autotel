/**
 * The W3C `baggage` header as OpenTelemetry's propagator builds it: how many
 * bytes an entry takes, which entries it sends, and which of a batch of
 * writes can be kept so that every one of them is sent.
 */
import type { BaggageEntry } from '@opentelemetry/api';
import { wellFormed } from './trace-context';

/** URI-encoded length, never throwing: a lone surrogate counts as U+FFFD. */
function encodedLength(text: string): number {
  return encodeURIComponent(wellFormed(text)).length;
}

/**
 * An entry's size in the W3C `baggage` header, as OpenTelemetry's propagator
 * writes it: `key=value[;metadata]`, URI-encoded, so ASCII and one byte a
 * character.
 */
function wireSize(key: string, entry: BaggageEntry): number {
  // Never throws: inherited baggage another writer set may be malformed.
  // `;metadata` whenever metadata is present, even when it reads as ''.
  return (
    encodedLength(key) +
    1 +
    encodedLength(entry.value) +
    (entry.metadata === undefined ? 0 : 1 + entry.metadata.toString().length)
  );
}

// OpenTelemetry's W3C propagator drops a pair longer than MAX_PAIR_SIZE,
// takes the first MAX_ENTRIES of the rest, and leaves out any of those that
// would take the header past MAX_HEADER_SIZE.
const MAX_PAIR_SIZE = 4096;
const MAX_ENTRIES = 180;
export const MAX_HEADER_SIZE = 8192;

/** A batch's writes, split into those kept and those rejected. */
export interface BatchPlan<W> {
  accepted: W[];
  rejected: W[];
}

/**
 * Which of a batch's writes to keep, judged on the batch's final state,
 * never one write at a time: writes interact (a shrink can make an earlier
 * too-long entry sendable and push another out). The final header must carry
 * every kept write, keep every entry it already carried that the batch did
 * not replace (a schema write must not evict baggage another writer set),
 * and fit `headerLimit`, or at least not grow when the baggage arrived over
 * it. A pair too long ever to send is out first (failing alone is not
 * enough: a write can fit only beside another's shrink); of the rest, the
 * largest set that fits is kept.
 *
 * @internal exported for tests
 */
export function planBatch<
  W extends { key: string; fullKey: string; entry: BaggageEntry },
>(
  initial: ReadonlyMap<string, BaggageEntry>,
  batch: readonly W[],
  headerLimit: number,
  exhaustiveUpTo?: number,
): BatchPlan<W> {
  const sentBefore = sentHeader(initial);
  const budget = Math.max(headerLimit, sentBefore.size);
  const writes = batch.map((write) => ({
    write,
    key: write.key,
    cost:
      sentHeader(new Map(initial).set(write.fullKey, write.entry)).sendable -
      sentBefore.sendable,
  }));
  type Weighed = (typeof writes)[number];
  const fits = (subset: Weighed[]): boolean => {
    const final = new Map(initial);
    for (const { write } of subset) final.set(write.fullKey, write.entry);
    const sent = sentHeader(final);
    const replaced = new Set(subset.map(({ write }) => write.fullKey));
    return (
      sent.size <= budget &&
      subset.every(({ write }) => sent.keys.has(write.fullKey)) &&
      [...sentBefore.keys].every((k) => replaced.has(k) || sent.keys.has(k))
    );
  };
  const kept = largestFitting(
    writes.filter(
      ({ write }) => wireSize(write.fullKey, write.entry) <= MAX_PAIR_SIZE,
    ),
    fits,
    exhaustiveUpTo,
  ).map(({ write }) => write);
  return {
    accepted: kept,
    rejected: batch.filter((write) => !kept.includes(write)),
  };
}

/**
 * The most writes that fit together, judged as a whole: the largest subset,
 * then the cheapest, then by key, so the outcome never depends on the
 * caller's key order. `cost` is what a write adds to the bytes the propagator
 * may send (negative for a shrink; a shrink that makes a too-long entry
 * sendable costs its whole size).
 *
 * Up to `exhaustiveUpTo` writes every subset is tried, which is exact. Past
 * that, writes are added cheapest first, each kept if the set still fits.
 * That is exact too whenever the inherited baggage fits the header (costs
 * then add up, and the most items under a budget are the cheapest ones);
 * it is only a best effort when the propagator is already leaving entries
 * out. The test suite checks the two against each other.
 */
function largestFitting<W extends { key: string; cost: number }>(
  writes: readonly W[],
  fits: (subset: W[]) => boolean,
  exhaustiveUpTo = 12,
): W[] {
  const sorted = writes.toSorted(
    (a, b) => a.cost - b.cost || a.key.localeCompare(b.key),
  );
  if (fits(sorted)) return sorted; // the usual case: the whole batch fits
  if (sorted.length > exhaustiveUpTo) {
    const subset: W[] = [];
    for (const write of sorted)
      if (fits([...subset, write])) subset.push(write);
    return subset;
  }
  const subsets = Array.from({ length: 2 ** sorted.length }, (_, mask) =>
    sorted.filter((_, i) => mask & (1 << i)),
  );
  const cost = (subset: W[]) =>
    subset.reduce((sum, write) => sum + write.cost, 0);
  const keys = (subset: W[]) =>
    subset
      .map((write) => write.key)
      .toSorted()
      .join('\n');
  const ranked = subsets.toSorted(
    (a, b) =>
      b.length - a.length ||
      cost(a) - cost(b) ||
      keys(a).localeCompare(keys(b)),
  );
  // The empty subset always fits: the header is left as it was.
  return ranked.find((subset) => fits(subset)) ?? [];
}

/**
 * The header the propagator would send for these entries, choosing exactly as
 * it does: which keys it carries, and its length.
 */
/** What the propagator would send for a set of entries. */
interface SentHeader {
  /** The keys it carries. */
  keys: Set<string>;
  /** Its length in bytes. */
  size: number;
  /** Every entry it may send (not too long, within the first 180), joined. */
  sendable: number;
}

function sentHeader(entries: ReadonlyMap<string, BaggageEntry>): SentHeader {
  const pairs = [...entries]
    .map(([key, entry]) => [key, wireSize(key, entry)] as const)
    .filter(([, size]) => size <= MAX_PAIR_SIZE)
    .slice(0, MAX_ENTRIES);
  const sendable =
    Math.max(0, pairs.length - 1) +
    pairs.reduce((sum, [, pairSize]) => sum + pairSize, 0);
  const keys = new Set<string>();
  let size = 0;
  for (const [key, pairSize] of pairs) {
    const next = size + (size > 0 ? 1 : 0) + pairSize;
    if (next > MAX_HEADER_SIZE) continue;
    size = next;
    keys.add(key);
  }
  return { keys, size, sendable };
}
