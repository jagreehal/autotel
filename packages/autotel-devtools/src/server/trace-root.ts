// src/server/trace-root.ts
import type { SpanData } from './types';

/** What pickRoot() answers with. */
interface PickRootResult {
  rootSpan: SpanData;
  partial: boolean;
}

/**
 * Pick the span to present as the top of a trace, and report whether the real
 * root is missing from `spans`.
 *
 * A true root has no parent at all. Failing that the trace is a fragment, so
 * fall back to the earliest span whose parent did not arrive rather than
 * presenting an arbitrary child as though it were the root. Sampling makes this
 * ordinary: a sender may keep a failed span and drop the routine parent above
 * it, and a receiver that hides the difference makes a half-trace look complete.
 *
 * `partial` is a fact about the span set passed in, not about a batch — spans of
 * one trace arrive across several exports, so recompute this wherever the set
 * grows instead of caching the first answer.
 *
 * Pass spans sorted by start time; the fallbacks then pick the earliest
 * candidate rather than whichever one the caller happened to receive first.
 */
export function pickRoot(spans: SpanData[]): PickRootResult {
  const present = new Set(spans.map((s) => s.spanId));
  const trueRoot = spans.find((s) => !s.parentSpanId);
  const orphan = spans.find(
    (s) => s.parentSpanId && !present.has(s.parentSpanId),
  );
  return { rootSpan: trueRoot ?? orphan ?? spans[0], partial: !trueRoot };
}
