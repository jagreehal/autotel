import {
  flush,
  getTracer,
  resolveTraceUrl,
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

import type { RunnerTaskResult, TaskMeta, TestAnnotation } from 'vitest';

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
 * Reads the context manager's private AsyncLocalStorage, since the
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

/** The parts of a Vitest test task the span reads and writes. */
export interface OtelTestTask {
  name: string;
  file?: { name: string };
  suite?: { name: string };
  meta: TaskMeta;
  result?: Pick<RunnerTaskResult, 'state' | 'errors'>;
}

/** Vitest's test-context annotate; absent on versions without it. */
type Annotate = (
  message: string,
  type?: string,
) => Promise<TestAnnotation | void>;

export interface StartedTestSpan {
  span: Span;
  /** The active context with `span` set on it. */
  ctx: Context;
}

/**
 * Start the test's span. Synchronous, so a caller can enter its context before
 * awaiting anything.
 */
export function startTestSpan(task: OtelTestTask): StartedTestSpan {
  ensureCollector();
  const span = getTracer(TRACER_NAME, TRACER_VERSION).startSpan(
    `test:${task.name}`,
    {
      attributes: {
        'test.name': task.name,
        'test.file': task.file?.name ?? '',
        'test.suite': task.suite?.name ?? '',
      },
    },
  );
  return { span, ctx: otelTrace.setSpan(otelContext.active(), span) };
}

/**
 * Set by the first flush that fails. Every later flush would wait out the same
 * timeout for the same missing collector, once per test, so they are skipped:
 * one timeout per worker, not per test.
 */
let flushUnavailable = false;

/**
 * Run the test under its span, then end the span and drain its trace onto
 * `task.meta.otelSpans`. Shared by the fixture and the `autotel-vitest/setup`
 * hook, which differ only in how `run` makes the span's context active.
 */
export async function runInTestSpan(
  task: OtelTestTask,
  span: Span,
  annotate: Annotate | undefined,
  run: () => Promise<void>,
): Promise<void> {
  // Reporters - and the browser trace view's step list - render annotations,
  // so the test report links back to this trace. A decoration must never fail
  // a test, hence the swallowed rejection.
  if (annotate) {
    const traceId = span.spanContext().traceId;
    await annotate(
      resolveTraceUrl(undefined, traceId) ?? traceId,
      'otel-trace',
    ).catch(() => {});
  }

  try {
    await run();
  } finally {
    // A failed test does not reject `use()` or `runTest()`: Vitest catches the
    // error and records it on the task before handing control back, so the
    // outcome is read from there.
    if (task.result?.state === 'fail') {
      span.setStatus({ code: SpanStatusCode.ERROR });
      for (const error of task.result.errors ?? []) span.recordException(error);
    }
    span.end();
    // Export is asynchronous even through SimpleSpanProcessor, so the spans
    // are not in the collector yet on the line after end(). Telemetry must
    // never fail a test, so a collector that is not listening costs one
    // warning and one timeout. The in-memory collector is not what timed out,
    // so the drain below still finds the spans.
    if (!flushUnavailable) {
      try {
        await flush();
      } catch (error) {
        flushUnavailable = true;
        console.warn(
          `[autotel-vitest] Could not flush test spans, so no later test in this worker flushes either; test results are unaffected. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const { traceId, spanId } = span.spanContext();
    const spans = otelTestCollector.drainTrace(traceId, spanId);
    if (spans.length > 0) {
      task.meta.otelSpans = spans;
    }
  }
}

export type OtelFixtureFn = (
  args: { task: OtelTestTask; annotate?: Annotate },
  use: (span: Span) => Promise<void>,
) => Promise<void>;

export const otelTestSpanFixture: [OtelFixtureFn, { auto: true }] = [
  async ({ task, annotate }, use) => {
    const { span, ctx } = startTestSpan(task);
    // Before awaiting anything at all: `enterWith` binds to the async resource
    // this fixture shares with the runner, and an await ahead of it detaches
    // the entry onto a continuation the test body never inherits.
    const entered = enterContext(ctx);
    // enterContext reaches the test body; context.with does not. It only fails
    // on a context manager with no AsyncLocalStorage behind it, where
    // context.with is still the correct call.
    await runInTestSpan(task, span, annotate, () =>
      entered ? use(span) : otelContext.with(ctx, () => use(span)),
    );
  },
  { auto: true },
];
