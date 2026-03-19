import {
  getTracer,
  getAutotelTracerProvider,
  context as otelContext,
  otelTrace,
  SpanStatusCode,
} from 'autotel';
import { TestSpanCollector } from 'autotel/test-span-collector';
import { SimpleSpanProcessor } from 'autotel/processors';

const TRACER_NAME = 'vitest-tests';
const TRACER_VERSION = '0.1.0';

let collector: TestSpanCollector | null = null;

interface TracerProviderWithProcessor {
  addSpanProcessor(processor: unknown): void;
}

function ensureCollector(): TestSpanCollector {
  if (!collector) {
    collector = new TestSpanCollector();
    const provider = getAutotelTracerProvider();
    if ('addSpanProcessor' in provider) {
      (provider as TracerProviderWithProcessor).addSpanProcessor(
        new SimpleSpanProcessor(collector),
      );
    }
  }
  return collector;
}

export type OtelFixtureFn = (
  args: { task: { name: string; file?: { name: string }; suite?: { name: string }; meta: Record<string, unknown> } },
  use: (span: unknown) => Promise<void>,
) => Promise<void>;

export const otelTestSpanFixture: [OtelFixtureFn, { auto: true }] = [
  async (
    { task }: { task: { name: string; file?: { name: string }; suite?: { name: string }; meta: Record<string, unknown> } },
    use: (span: unknown) => Promise<void>,
  ) => {
    ensureCollector();
    const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
    const span = tracer.startSpan(`test:${task.name}`, {
      attributes: {
        'test.name': task.name,
        'test.file': task.file?.name ?? '',
        'test.suite': task.suite?.name ?? '',
      },
    });
    const ctx = otelTrace.setSpan(otelContext.active(), span);
    try {
      await otelContext.with(ctx, () => use(span));
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
      const traceId = span.spanContext().traceId;
      const rootSpanId = span.spanContext().spanId;
      const spans = collector!.drainTrace(traceId, rootSpanId);
      if (spans.length > 0) {
        (task.meta as Record<string, unknown>).otelSpans = spans;
      }
    }
  },
  { auto: true },
];
