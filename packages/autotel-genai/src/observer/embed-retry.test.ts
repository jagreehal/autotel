import { AsyncLocalStorage } from 'node:async_hooks';
import {
  context as otelContext,
  ROOT_CONTEXT,
  SpanStatusCode,
  type Context,
  type ContextManager,
  type Tracer,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it } from 'vitest';
import { autotelTelemetry } from './ai-sdk-telemetry.js';

class Als implements ContextManager {
  private readonly als = new AsyncLocalStorage<Context>();
  active(): Context {
    return this.als.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.als.run(context, () =>
      fn.apply(thisArg as ThisParameterType<F>, args),
    );
  }
  bind<T>(_c: Context, t: T): T {
    return t;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    return this;
  }
}
otelContext.setGlobalContextManager(new Als());

let exporter: InMemorySpanExporter;
let tracer: Tracer;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  tracer = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }).getTracer('probe');
});

const spans = () => exporter.getFinishedSpans();
const failed = (s: ReadableSpan) => s.status.code === SpanStatusCode.ERROR;

/**
 * The AI SDK reports an embedding attempt that succeeded and says nothing at
 * all about one that threw — the retry simply starts a new attempt. So a span
 * still open when the call finishes is, by construction, an attempt that never
 * completed, and reporting it as a healthy span of the whole call's duration
 * misreads a retried failure as a slow success.
 */
describe('embedding retries', () => {
  it('marks the abandoned attempt as failed, not as a long success', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c2', operationId: 'ai.embed', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c2', embedCallId: 'a1', modelId: 'text-3' });
    // Attempt 1 threw: no end for `a1`, the SDK just tries again.
    t.onEmbedStart({ callId: 'c2', embedCallId: 'a2', modelId: 'text-3' });
    t.onEmbedEnd({
      callId: 'c2',
      embedCallId: 'a2',
      modelId: 'text-3',
      usage: { tokens: 5 },
    });
    t.onEnd({ callId: 'c2' });

    expect(spans()).toHaveLength(2);
    expect(spans().filter((span) => failed(span))).toHaveLength(1);
  });

  it('closes the abandoned attempt when the retry starts, not at the end', () => {
    // Left until the call ends, the failed attempt's duration swallows the
    // retry backoff and every later attempt — the opposite of the real
    // model-call duration these spans are documented to measure. The next
    // attempt starting is the tightest bound available.
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c4', operationId: 'ai.embed', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c4', embedCallId: 'a1', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c4', embedCallId: 'a2', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c4', embedCallId: 'a2', modelId: 'text-3' });
    t.onEnd({ callId: 'c4' });

    // Export order is completion order: the abandoned attempt has to finish
    // before the successful retry does, not after the whole call.
    expect(failed(spans()[0]!)).toBe(true);
  });

  it('reports a retry that reuses the same attempt id too', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c1', operationId: 'ai.embed', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c1', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c1', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c1', modelId: 'text-3', usage: { tokens: 5 } });
    t.onEnd({ callId: 'c1' });

    // Both attempts happened, so both are worth a span — the failed one was
    // being dropped entirely when the ids collided.
    expect(spans()).toHaveLength(2);
    expect(spans().filter((span) => failed(span))).toHaveLength(1);
  });
});

/** Epoch milliseconds, for comparing when spans actually began and ended. */
const ms = ([seconds, nanos]: [number, number]) => seconds * 1e3 + nanos / 1e6;

/**
 * Push the clock far enough that span timestamps are distinguishable.
 * Without it every event in a synchronous test lands in the same millisecond
 * and any assertion about ordering passes whatever the code does.
 */
function tick(): void {
  const until = Date.now() + 5;
  while (Date.now() < until) {
    /* busy-wait: the OTel clock is not fakeable from here */
  }
}

describe('embedMany runs embeddings in parallel', () => {
  it("does not truncate a concurrent batch at an unrelated one's start", () => {
    // batch A and batch B overlap; A fails and is retried under a new id.
    // Treating "the next attempt to start" as A's replacement would end A at
    // B's start — reporting a batch that ran for the whole call as a fast
    // failure. There is no batch identity in these events to correlate on, so
    // the honest answer is to leave it open rather than guess.
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c6', operationId: 'ai.embedMany', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c6', embedCallId: 'A', modelId: 'text-3' });
    tick();
    t.onEmbedStart({ callId: 'c6', embedCallId: 'B', modelId: 'text-3' });
    tick();
    // A has failed by now; the SDK says nothing and retries it under a new id.
    t.onEmbedStart({ callId: 'c6', embedCallId: 'Aretry', modelId: 'text-3' });
    tick();
    t.onEmbedEnd({ callId: 'c6', embedCallId: 'Aretry', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c6', embedCallId: 'B', modelId: 'text-3' });
    tick();
    t.onEnd({ callId: 'c6' });

    const abandoned = spans().find((span) => failed(span))!;
    const batchB = spans().find((span) => !failed(span))!;
    expect(abandoned).toBeDefined();
    expect(ms(abandoned.endTime)).toBeGreaterThan(ms(batchB.startTime));
  });

  it('marks an abandoned batch failed, and does not claim to time it', () => {
    // The duration of an attempt nothing ever reported on is unknowable: this
    // is an upper bound, and ERROR is what says do not read it as latency.
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c8', operationId: 'ai.embedMany', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c8', embedCallId: 'a1', modelId: 'text-3' });
    tick();
    t.onEmbedStart({ callId: 'c8', embedCallId: 'a2', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c8', embedCallId: 'a2', modelId: 'text-3' });
    t.onEnd({ callId: 'c8' });

    expect(spans()).toHaveLength(2);
    expect(spans().filter((span) => failed(span))).toHaveLength(1);
  });

  it('closes a colliding attempt id straight away, parallel or not', () => {
    // Two concurrent embeds cannot share an id, so a repeat is unambiguously a
    // retry even where the operation genuinely runs batches in parallel.
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c7', operationId: 'ai.embedMany', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c7', embedCallId: 'a1', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c7', embedCallId: 'a1', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c7', embedCallId: 'a1', modelId: 'text-3' });
    t.onEnd({ callId: 'c7' });

    expect(spans()).toHaveLength(2);
    expect(spans().filter((span) => failed(span))).toHaveLength(1);
  });

  it('leaves genuinely concurrent embeds alone', () => {
    // Two attempts open at once is a retry for embed() and ordinary work for
    // embedMany(), and the events look identical. Only the operation says
    // which, so the heuristic must not run here.
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c3', operationId: 'ai.embedMany', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c3', embedCallId: 'p1', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c3', embedCallId: 'p2', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c3', embedCallId: 'p1', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c3', embedCallId: 'p2', modelId: 'text-3' });
    t.onEnd({ callId: 'c3' });

    expect(spans()).toHaveLength(2);
    expect(spans().filter((span) => failed(span))).toHaveLength(0);
  });

  it('still fails a parallel branch that never completed', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'c5', operationId: 'ai.embedMany', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c5', embedCallId: 'p1', modelId: 'text-3' });
    t.onEmbedStart({ callId: 'c5', embedCallId: 'p2', modelId: 'text-3' });
    t.onEmbedEnd({ callId: 'c5', embedCallId: 'p1', modelId: 'text-3' });
    t.onEnd({ callId: 'c5' });

    expect(spans()).toHaveLength(2);
    expect(spans().filter((span) => failed(span))).toHaveLength(1);
  });
});
