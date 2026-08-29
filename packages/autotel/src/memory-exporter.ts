/**
 * An in-memory span exporter for tests, examples and local checks.
 *
 * Reading telemetry back is how you assert on it, and doing that used to mean
 * writing a `SpanExporter` by hand against the OpenTelemetry SDK types. This
 * one hands back plain objects, so a test can read a span the way a backend
 * would see it and nothing has to import the SDK.
 *
 * @example
 * ```typescript
 * import { init } from 'autotel';
 * import { createMemoryExporter } from 'autotel/testing';
 *
 * const exporter = createMemoryExporter();
 * init({ service: 'checkout', spanExporters: [exporter] });
 *
 * await charge();
 * await flush();
 *
 * expect(exporter.findSpan('checkout.charge')?.attributes['payment.provider'])
 *   .toBe('stripe');
 * ```
 */
import type { Attributes, SpanStatus } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/** One finished span, flattened to the fields an assertion usually wants. */
export interface RecordedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  /** Wall-clock duration of the span, in milliseconds. */
  durationMs: number;
  attributes: Attributes;
  status: SpanStatus;
}

export interface MemoryExporter extends SpanExporter {
  /** Every span exported so far, in the order it finished. */
  spans(): RecordedSpan[];
  /** The first span with this name, or undefined. */
  findSpan(name: string): RecordedSpan | undefined;
  /** Every span with this name. */
  findSpans(name: string): RecordedSpan[];
  /** Discard what has been collected. */
  reset(): void;
}

function toRecordedSpan(span: ReadableSpan): RecordedSpan {
  return {
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
    attributes: { ...span.attributes },
    status: span.status,
  };
}

export function createMemoryExporter(): MemoryExporter {
  const collected: RecordedSpan[] = [];

  return {
    export(spans, resultCallback) {
      for (const span of spans) collected.push(toRecordedSpan(span));
      // 0 is ExportResultCode.SUCCESS. Spelled as the literal so this module
      // needs no runtime dependency on the SDK, only its types.
      resultCallback({ code: 0 });
    },
    async shutdown() {},
    async forceFlush() {},
    spans: () => [...collected],
    findSpan: (name) => collected.find((span) => span.name === name),
    findSpans: (name) => collected.filter((span) => span.name === name),
    reset: () => {
      collected.length = 0;
    },
  };
}
