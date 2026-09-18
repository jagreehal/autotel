/**
 * A sampler that keeps whole sessions.
 *
 * `Math.random() < rate` per span keeps a tenth of every session, which is
 * enough to draw a chart and never enough to answer a support ticket: every
 * visit is present, and none of them is complete. Hashing the session id
 * instead keeps all of a tenth of the visits, and those you can actually read.
 *
 * Falls back to the trace id where there is no session, which is still better
 * than random: a trace is then sampled or not as a whole, rather than per span.
 */

import {
  AlwaysOnSampler,
  ParentBasedSampler,
  SamplingDecision,
  type Sampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import { sampleByKey } from './sampling';
import { getSessionAttributes } from './session';
import { SESSION } from './semconv';

export function createSessionRatioSampler(ratio: number): Sampler {
  return {
    shouldSample(
      _context,
      traceId,
      _spanName,
      _spanKind,
      _attributes,
      _links,
    ): SamplingResult {
      if (ratio >= 1) return { decision: SamplingDecision.RECORD_AND_SAMPLED };
      if (ratio <= 0) return { decision: SamplingDecision.NOT_RECORD };
      const key = getSessionAttributes()?.[SESSION.ID] ?? traceId;
      return sampleByKey(key, ratio)
        ? { decision: SamplingDecision.RECORD_AND_SAMPLED }
        : { decision: SamplingDecision.NOT_RECORD };
    },
    toString() {
      return `SessionRatioSampler(${ratio})`;
    },
  };
}

/**
 * Drops the per-resource `resourceFetch` spans that document-load
 * instrumentation emits, keeping the `documentLoad`/`documentFetch` spans and
 * everything else. Every other decision is delegated to `inner`, which
 * defaults to what a provider applies with no sampler at all: parent-based
 * always-on, so a child of an unsampled parent stays unsampled.
 */
export function withoutResourceFetch(
  inner: Sampler = new ParentBasedSampler({ root: new AlwaysOnSampler() }),
): Sampler {
  return {
    shouldSample(context, traceId, spanName, spanKind, attributes, links) {
      if (spanName === 'resourceFetch') {
        return { decision: SamplingDecision.NOT_RECORD };
      }
      return inner.shouldSample(
        context,
        traceId,
        spanName,
        spanKind,
        attributes,
        links,
      );
    },
    toString() {
      return `WithoutResourceFetch{${inner.toString()}}`;
    },
  };
}
