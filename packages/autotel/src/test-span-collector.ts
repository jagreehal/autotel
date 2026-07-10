/**
 * TestSpanCollector — SpanExporter that groups finished spans by traceId
 * and drains per-trace for embedding in test metadata.
 *
 * Wire it to a tracer provider, register that provider with autotel, then
 * create spans through autotel's tracer so finished spans reach the collector.
 *
 * @example
 * ```typescript
 * import { TestSpanCollector } from 'autotel/test-span-collector';
 * import { SimpleSpanProcessor } from 'autotel/processors';
 * import { setAutotelTracerProvider, getAutotelTracer } from 'autotel';
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 *
 * const collector = new TestSpanCollector();
 *
 * // OTel SDK v2: pass processors at construction, then register the provider.
 * const provider = new NodeTracerProvider({
 *   spanProcessors: [new SimpleSpanProcessor(collector)],
 * });
 * setAutotelTracerProvider(provider);
 *
 * const tracer = getAutotelTracer('test');
 * const root = tracer.startSpan('operation');
 * // ...work, child spans...
 * root.end();
 *
 * const spans = collector.drainTrace(
 *   root.spanContext().traceId,
 *   root.spanContext().spanId,
 * );
 * // spans contains the root span and its descendants
 * ```
 *
 * For high-level instrumentation written with `span()` / `track()`, prefer
 * `createTraceCollector()` from `autotel/testing`. For a plain low-level
 * exporter, use `InMemorySpanExporter` from `autotel/exporters`.
 */

import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode } from '@opentelemetry/api';

/** @see ExportResultCode from @opentelemetry/core */
const ExportResultCode = { SUCCESS: 0, FAILED: 1 } as const;

/** Attribute value types that survive serialization */
type SerializableValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

/**
 * Portable serialized span for embedding in test metadata.
 * `startTimeMs` is derived from OTel HrTime — epoch-based wall-clock ms in the current SDK.
 *
 * Defined as a `type` (not `interface`) so it is assignable to
 * `Record<string, unknown>` in TypeScript 6+ strict mode.
 */
export type SerializedSpan = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeMs: number;
  durationMs: number;
  status: 'ok' | 'error' | 'unset';
  statusMessage?: string;
  attributes?: Record<string, SerializableValue>;
};

export class TestSpanCollector implements SpanExporter {
  private traces = new Map<string, ReadableSpan[]>();

  export(
    spans: ReadableSpan[],
    callback: (result: { code: number }) => void,
  ): void {
    for (const span of spans) {
      const traceId = span.spanContext().traceId;
      let list = this.traces.get(traceId);
      if (!list) {
        list = [];
        this.traces.set(traceId, list);
      }
      list.push(span);
    }
    callback({ code: ExportResultCode.SUCCESS });
  }

  /**
   * Drain and serialize spans that are descendants of `rootSpanId` within `traceId`.
   * Filters to the subtree rooted at the test span to prevent cross-test mixing.
   * Removes the entire traceId entry from the collector.
   */
  drainTrace(traceId: string, rootSpanId: string): SerializedSpan[] {
    const allSpans = this.traces.get(traceId);
    this.traces.delete(traceId);
    if (!allSpans?.length) return [];

    // Build spanId → span index for efficient parent-chain walking
    const byId = new Map<string, ReadableSpan>();
    for (const s of allSpans) byId.set(s.spanContext().spanId, s);

    // Filter to spans that are the root or descendants of rootSpanId
    const included = allSpans.filter((s) => {
      let id: string | undefined = s.spanContext().spanId;
      while (id) {
        if (id === rootSpanId) return true;
        const parent = byId.get(id);
        const parentId = parent?.parentSpanContext?.spanId || undefined;
        if (parentId === id) break; // cycle guard
        id = parentId;
      }
      return false;
    });

    return included.map((s) => serializeSpan(s));
  }

  shutdown(): Promise<void> {
    this.traces.clear();
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function hrTimeToMs(hr: [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1_000_000;
}

function isSerializable(v: unknown): v is SerializableValue {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return true;
  if (Array.isArray(v) && v.length > 0) {
    const t = typeof v[0];
    return (
      (t === 'string' || t === 'number' || t === 'boolean') &&
      v.every((e) => typeof e === t)
    );
  }
  return false;
}

export function serializeSpan(span: ReadableSpan): SerializedSpan {
  const attrs: Record<string, SerializableValue> = {};
  for (const [k, v] of Object.entries(span.attributes)) {
    if (isSerializable(v)) attrs[k] = v;
  }
  return {
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId || undefined,
    name: span.name,
    startTimeMs: hrTimeToMs(span.startTime as [number, number]),
    durationMs: hrTimeToMs(span.duration as [number, number]),
    status:
      span.status.code === SpanStatusCode.ERROR
        ? 'error'
        : span.status.code === SpanStatusCode.OK
          ? 'ok'
          : 'unset',
    statusMessage: span.status.message || undefined,
    attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
  };
}
