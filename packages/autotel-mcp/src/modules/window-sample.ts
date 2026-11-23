import type { TelemetryBackend } from '../backends/telemetry';
import type { SpanRecord, SpanSearchQuery } from '../types';

/**
 * Samples the whole window in four slices, so an early spike or version
 * change shows up alongside the newest records. Four keeps the request count
 * inside Datadog's spans limit of five a minute.
 */
const SLICES = 4;
const PER_SLICE = 250;

/**
 * Adjacent slices share their boundary instant, and a backend with inclusive
 * bounds returns a record sitting on it from both. Count each record by the
 * slice that returned the most copies of it: a boundary record seen once in
 * each slice counts once, while identical records within one slice (a log
 * line repeated in the same millisecond) all still count.
 */
export function mergeSlices<T>(
  slices: readonly (readonly T[])[],
  identity: (item: T) => string,
): T[] {
  const kept = new Map<string, T[]>();
  for (const slice of slices) {
    const local = new Map<string, T[]>();
    for (const item of slice) {
      const key = identity(item);
      const list = local.get(key);
      if (list) list.push(item);
      else local.set(key, [item]);
    }
    for (const [key, items] of local) {
      if (items.length > (kept.get(key)?.length ?? 0)) kept.set(key, items);
    }
  }
  return Array.from(kept.values()).flat();
}

const spanIdentity = (span: SpanRecord) => `${span.traceId}:${span.spanId}`;
export async function sampleAcrossWindow<T>(
  startMs: number,
  endMs: number,
  identity: (item: T) => string,
  fetch: (
    from: number,
    to: number,
    limit: number,
  ) => Promise<{ items: T[]; truncated?: boolean }>,
  options: { refine?: boolean } = {},
): Promise<{ items: T[]; capped: boolean }> {
  const sample = async (
    from: number,
    to: number,
    refine: boolean,
  ): Promise<{ items: T[][]; capped: boolean }> => {
    const width = (to - from) / SLICES;
    const slices = await Promise.all(
      Array.from({ length: SLICES }, async (_, index) => {
        const sliceFrom = Math.round(from + index * width);
        const sliceTo = Math.round(from + (index + 1) * width);
        const slice = await fetch(sliceFrom, sliceTo, PER_SLICE);
        const full = slice.truncated ?? slice.items.length >= PER_SLICE;
        // A full slice holds only its newest records. Telemetry arrives in
        // bursts, so one quarter can hold the whole story and return the end
        // of it; splitting that quarter once more reads its start too.
        if (full && refine && sliceTo - sliceFrom > SLICES) {
          return sample(sliceFrom, sliceTo, false);
        }
        return { items: [slice.items], capped: full };
      }),
    );
    return {
      items: slices.flatMap((slice) => slice.items),
      capped: slices.some((slice) => slice.capped),
    };
  };
  const { items, capped } = await sample(
    startMs,
    endMs,
    options.refine === true,
  );
  return { items: mergeSlices(items, identity), capped };
}

export function queryWindow(query: {
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
}) {
  const endMs = query.endTimeUnixMs ?? Date.now();
  return { startMs: query.startTimeUnixMs ?? endMs - 60 * 60_000, endMs };
}

export async function sampleSpans(
  backend: TelemetryBackend,
  query: SpanSearchQuery,
  options: { refine?: boolean } = {},
): Promise<{ items: SpanRecord[]; capped: boolean }> {
  const { startMs, endMs } = queryWindow(query);
  return sampleAcrossWindow(
    startMs,
    endMs,
    spanIdentity,
    async (from, to, limit) => {
      return backend.searchSpans({
        ...query,
        startTimeUnixMs: from,
        endTimeUnixMs: to,
        limit,
      });
    },
    options,
  );
}
