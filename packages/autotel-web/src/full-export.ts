/**
 * Full mode's span export: one batch per destination, spans filed under the
 * settled session, and extra exporters kept out of the traces they send.
 */
import type { Attributes } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  SamplingDecision,
  type Sampler,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import { normaliseOtlpEndpoint } from './otlp-endpoint';
import { settledSessionId } from './session';
import { asString } from './values';

/**
 * A processor per destination: the OTLP `endpoint` and each extra exporter.
 * One batch each, so a destination that is slow or down does not hold back,
 * or drop, what the others are sent. Empty when there is nowhere to send.
 */
export function exportProcessors(
  endpoint: string | undefined,
  extra: SpanExporter[] = [],
): SpanProcessor[] {
  const destinations = [
    // The endpoint's own requests are excluded by URL (selfInstrumentationIgnoreUrls).
    ...(endpoint
      ? [
          {
            // Accept a bare origin as init() does; without this a bare origin
            // POSTs to the collector root and 404s.
            exporter: new OTLPTraceExporter({
              url: normaliseOtlpEndpoint(endpoint),
            }),
            untraced: false,
          },
        ]
      : []),
    ...extra.map((exporter) => ({ exporter, untraced: true })),
  ];
  return destinations.map(
    ({ exporter, untraced }) =>
      new BatchSpanProcessor({
        exporter: outgoing(exporter, untraced),
        scheduledDelayMillis: 1000,
        maxExportBatchSize: 64,
      }),
  );
}

/** How many extra exporters are inside `export()` right now. */
let exporting = 0;

/**
 * Prepares a batch for one destination. Spans are filed under the visit's
 * settled session: one that ended while the owning join's SDK was still
 * starting carries a stand-in id, and by export time (the batch waits ~1s)
 * the vendor's session usually exists. See `settledSessionId`.
 *
 * `untraced` marks the requests an extra exporter makes. The fetch and XHR
 * instrumentations ignore OpenTelemetry's suppressed-tracing context, so
 * without this an exporter that sends over the network traces its own
 * request, which the next batch exports, forever.
 *
 * `untraced` covers requests started synchronously inside `export()`; an
 * exporter that sends later takes its URL in `ignoreUrls`.
 */
function outgoing(inner: SpanExporter, untraced: boolean): SpanExporter {
  return {
    export(spans, done) {
      for (const span of spans) {
        // SAFETY: attributes are plain and mutable until serialized; this
        // runs just before that.
        const attributes = span.attributes as Attributes;
        const id = asString(attributes['session.id']);
        if (id) attributes['session.id'] = settledSessionId(id);
      }
      if (untraced) exporting += 1;
      try {
        inner.export(spans, done);
      } finally {
        if (untraced) exporting -= 1;
      }
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}

/**
 * Declines every span started while an extra exporter is sending, and
 * delegates the rest to `inner` (by default what a provider applies with no
 * sampler: parent-based always-on).
 */
export function withoutExportRequests(
  inner: Sampler = new ParentBasedSampler({ root: new AlwaysOnSampler() }),
): Sampler {
  return {
    shouldSample(context, traceId, spanName, spanKind, attributes, links) {
      if (exporting > 0) return { decision: SamplingDecision.NOT_RECORD };
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
      return `WithoutExportRequests{${inner.toString()}}`;
    },
  };
}
