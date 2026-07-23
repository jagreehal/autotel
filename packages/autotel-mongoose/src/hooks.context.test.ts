import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
// kareem2 = npm alias for kareem@^2.6.3, the callback-based hook engine used by
// Mongoose < 8. The installed `kareem` (v3, Mongoose 8+) drives hooks via
// async/await and does not support the callback (`next`) protocol, so the
// context leak this test pins can only be reproduced against v2.
import Kareem from 'kareem2';
import { otelTrace, context } from 'autotel';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type { Tracer } from 'autotel';
import { wrapHookHandler } from './instrumentation';
import type { ResolvedConfig } from './types';

// Unlike hooks.test.ts, this suite registers a *real* AsyncLocalStorage
// context manager, so span parent/child relationships across async boundaries
// are meaningful and can be asserted.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager = new AsyncLocalStorageContextManager().enable();

beforeAll(() => {
  context.setGlobalContextManager(contextManager);
  otelTrace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  contextManager.disable();
  await provider.shutdown();
});

const tracer: Tracer = provider.getTracer('autotel-mongoose-context-test');

const config = {
  dbName: '',
  peerName: '',
  peerPort: 27_017,
  tracerName: 'autotel-mongoose-context-test',
  captureCollectionName: true,
  instrumentHooks: true,
  dbStatementSerializer: false,
  statementRedactor: false,
  customMethods: { enabled: false },
} as unknown as ResolvedConfig;

const wrap = (handler: any, name: string, type: 'pre' | 'post') =>
  wrapHookHandler(handler, name, type, tracer, config);

beforeEach(() => {
  exporter.reset();
});

describe('wrapHookHandler — span context isolation (kareem v2 callbacks)', () => {
  it('does not parent a sibling pre-save hook under an earlier hook that called next() from an async continuation', async () => {
    // Hook 1 mirrors a real-world pre-save that does a DB lookup and calls
    // `next()` from the query's callback — e.g. `Client.findById(...).then(next)`
    // inside a Release pre-save. That callback still runs with hook 1's span
    // active; Kareem then advances the chain synchronously from within it.
    const k = new Kareem();
    k.pre(
      'save',
      wrap(
        function (next: any) {
          Promise.resolve().then(() => next());
        },
        'save',
        'pre',
      ),
    );
    // Hook 2: an unrelated sibling later in the same chain.
    k.pre(
      'save',
      wrap(
        function (next: any) {
          next();
        },
        'save',
        'pre',
      ),
    );

    // Run the chain inside an enclosing operation span, mirroring the real
    // shape (`mongoose.save` wrapping its pre-hooks) and making the shared
    // parent a concrete spanId rather than a trivially-equal `undefined`.
    const operationSpan = tracer.startSpan('operation');
    await context.with(
      otelTrace.setSpan(context.active(), operationSpan),
      () =>
        new Promise<void>((resolve, reject) => {
          k.execPre('save', {}, [{}], (err: unknown) =>
            err ? reject(err) : resolve(),
          );
        }),
    );
    operationSpan.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);
    const [hook1Span, hook2Span] = spans;

    // The sibling must not be nested under hook 1's (already-ended) span —
    // both hooks must be direct children of the operation span.
    expect(hook1Span?.parentSpanContext?.spanId).toBe(
      operationSpan.spanContext().spanId,
    );
    expect(hook2Span?.parentSpanContext?.spanId).toBe(
      operationSpan.spanContext().spanId,
    );
  });
});
