import {
  flush,
  getTracer,
  getAutotelTracerProvider,
  context as otelContext,
  otelTrace,
  SpanStatusCode,
  type Context,
  type Span,
} from 'autotel';
import {
  TestSpanCollector,
  type SerializedSpan,
} from 'autotel/test-span-collector';
import { SimpleSpanProcessor } from 'autotel/processors';

import type { TaskMeta } from 'vitest';

declare module 'vitest' {
  interface TaskMeta {
    /** The spans this test recorded, drained by the `otelSpan` fixture. */
    otelSpans?: Array<SerializedSpan>;
  }
}

const TRACER_NAME = 'vitest-tests';
const TRACER_VERSION = '0.1.0';

/**
 * The collector the fixture drains onto `task.meta.otelSpans`.
 *
 * OpenTelemetry SDK 2.x removed `addSpanProcessor`, so on 2.x a processor can
 * only be registered when the provider is built. Hand this collector to
 * `init()` in your setup file so the fixture has spans to drain:
 *
 * ```ts
 * import { SimpleSpanProcessor } from 'autotel/processors';
 * import { otelTestCollector } from 'autotel-vitest';
 *
 * init({
 *   service: 'unit-tests',
 *   spanProcessors: [new SimpleSpanProcessor(otelTestCollector)],
 * });
 * ```
 */
export const otelTestCollector = new TestSpanCollector();

interface TracerProviderWithProcessor {
  addSpanProcessor(processor: SimpleSpanProcessor): void;
}

/**
 * The context manager's private storage. OTel's ContextManager interface has no
 * callback-free way to enter a context, so the fixture reaches for the
 * AsyncLocalStorage underneath it - see enterContext below for why.
 */
interface ContextManagerInternals {
  _getContextManager?: () => {
    _asyncLocalStorage?: { enterWith?: (value: Context) => void };
  };
}

/**
 * Make `ctx` the active context for the test body.
 *
 * `context.with(ctx, () => use(span))` does not work here. Vitest resolves a
 * fixture's `use()` from the runner, not from inside the fixture's own call
 * stack, so a context established around `use()` is not the one the test body
 * observes — every span the test creates starts a new trace instead of
 * parenting to the test span. Entering the context on this async resource
 * instead is inherited by the test body and everything it awaits.
 *
 * ponytail: reads the context manager's private AsyncLocalStorage, since the
 * OTel ContextManager interface has no callback-free entry point. Returns false
 * on any manager that does not expose one, and the caller falls back to
 * `context.with`.
 */
function enterContext(ctx: Context): boolean {
  // SAFETY: the members named on ContextManagerInternals are all optional, and
  // every one is probed before it is called. A context API that does not expose
  // them takes the `return false` below and the caller falls back to
  // `context.with`.
  const internals = otelContext as unknown as ContextManagerInternals;
  const storage = internals._getContextManager?.()?._asyncLocalStorage;
  const enterWith = storage?.enterWith;
  if (enterWith === undefined) return false;
  enterWith.call(storage, ctx);
  return true;
}

let attached = false;

function ensureCollector(): TestSpanCollector {
  // Late registration still works on SDK 1.x and on autotel's isolated
  // provider. On SDK 2.x this is absent and init() is the only way in.
  if (!attached) {
    attached = true;
    const provider = getAutotelTracerProvider();
    if ('addSpanProcessor' in provider) {
      // SAFETY: the guard above established the method exists; it is on the SDK's
      // provider implementation rather than on the TracerProvider interface.
      (provider as TracerProviderWithProcessor).addSpanProcessor(
        new SimpleSpanProcessor(otelTestCollector),
      );
    }
  }
  return otelTestCollector;
}

export type OtelFixtureFn = (
  args: {
    task: {
      name: string;
      file?: { name: string };
      suite?: { name: string };
      meta: TaskMeta;
    };
  },
  use: (span: Span) => Promise<void>,
) => Promise<void>;

export const otelTestSpanFixture: [OtelFixtureFn, { auto: true }] = [
  async ({ task }, use) => {
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
      // enterContext reaches the test body; context.with does not. It only
      // fails on a context manager with no AsyncLocalStorage behind it, where
      // context.with is still the correct call.
      await (enterContext(ctx)
        ? use(span)
        : otelContext.with(ctx, () => use(span)));
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    } finally {
      span.end();
      // Export is asynchronous even through SimpleSpanProcessor, so the spans
      // are not in the collector yet on the line after end().
      await flush();
      const traceId = span.spanContext().traceId;
      const rootSpanId = span.spanContext().spanId;
      const spans = otelTestCollector.drainTrace(traceId, rootSpanId);
      if (spans.length > 0) {
        task.meta.otelSpans = spans;
      }
    }
  },
  { auto: true },
];
