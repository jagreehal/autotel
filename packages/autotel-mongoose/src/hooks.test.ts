import { describe, it, expect, beforeEach } from 'vitest';
import Kareem from 'kareem';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import type { Tracer } from 'autotel';
import { wrapHookHandler } from './instrumentation';
import type { ResolvedConfig } from './types';

// These are unit tests driven against Kareem (Mongoose's hook library)
// directly — no `mongodb-memory-server`, so they run in milliseconds. They pin
// the three behaviours the arity/call-time-detection fix depends on:
//   1. the wrapper preserves the handler's declared arity,
//   2. error-handling middleware is still detected (fires on error, not
//      success),
//   3. synchronous single-arg data hooks actually end their span.

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const tracer: Tracer = provider.getTracer('autotel-mongoose-hooks-test');

// Minimal resolved config — only the fields `wrapHookHandler` reads matter.
const config = {
  dbName: '',
  peerName: '',
  peerPort: 27_017,
  tracerName: 'autotel-mongoose-hooks-test',
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

describe('wrapHookHandler — arity preservation', () => {
  it('preserves the handler arity so Kareem sees the real length', () => {
    // Kareem compares `fn.length` with exact arithmetic; a `...args` wrapper
    // reporting 0 would break error-middleware detection and callback awaiting.
    expect(wrap(function (doc: any) {}, 'save', 'post').length).toBe(1);
    expect(wrap(function (doc: any, next: any) {}, 'save', 'post').length).toBe(
      2,
    );
    expect(
      wrap(function (err: any, doc: any, next: any) {}, 'save', 'post').length,
    ).toBe(3);
  });
});

describe('wrapHookHandler — error-handling middleware', () => {
  it('fires on the error path and not on the success path', async () => {
    let fired = 0;
    const handler = function (_err: any, _doc: any, next: any) {
      fired++;
      next();
    };

    const k = new Kareem();
    k.post('save', wrap(handler, 'save', 'post'));

    // Success path: Kareem must skip error-handling middleware.
    await k.execPost('save', null, [{ value: 1 }], {});
    expect(fired).toBe(0);

    // Error path: it must run (arity 3 === numArgs(1) + 2).
    try {
      await k.execPost('save', null, [{ value: 1 }], {
        error: new Error('boom'),
      });
    } catch {
      // execPost may re-throw the original error; we only assert the hook ran.
    }
    expect(fired).toBe(1);
  });
});

describe('wrapHookHandler — span lifecycle', () => {
  it('ends the span for a synchronous single-arg data hook', async () => {
    // `post('save', (doc) => {})` never reads Kareem's appended callback, so
    // the wrapper must NOT defer finalization to it — otherwise the span leaks.
    const handler = function (_doc: any) {
      // synchronous, returns undefined
    };

    const k = new Kareem();
    k.post('save', wrap(handler, 'save', 'post'));
    await k.execPost('save', null, [{ value: 1 }], {});

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toContain('post.save');
  });

  it('ends the span for a genuine callback-style hook once next is called', async () => {
    const handler = function (_doc: any, next: any) {
      next();
    };

    const k = new Kareem();
    k.post('save', wrap(handler, 'save', 'post'));
    await k.execPost('save', null, [{ value: 1 }], {});

    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('synthesizes next for a callback-style pre hook (Kareem passes none)', async () => {
    // `execPre` never supplies a callback, so a declared `(next)` param must
    // get a synthesized one — otherwise `next()` throws and the span leaks.
    let called = false;
    const handler = function (next: any) {
      called = true;
      next();
    };

    const k = new Kareem();
    k.pre('save', wrap(handler, 'save', 'pre'));
    await k.execPre('save', null, [{ some: 'option' }]);

    expect(called).toBe(true);
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('ends the span for a promise-style pre hook', async () => {
    const handler = async function () {
      // async, no callback
    };

    const k = new Kareem();
    k.pre('save', wrap(handler, 'save', 'pre'));
    await k.execPre('save', null, [{}]);

    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('keeps positional args in order for post(query, (doc, next))', async () => {
    let receivedDoc: any;
    let receivedNextType: string | undefined;
    const handler = function (doc: any, next: any) {
      receivedDoc = doc;
      receivedNextType = typeof next;
      next();
    };

    const k = new Kareem();
    k.post('findOneAndUpdate', wrap(handler, 'findOneAndUpdate', 'post'));
    await k.execPost('findOneAndUpdate', null, [{ value: 2 }], {});

    expect(typeof receivedDoc).not.toBe('function');
    expect(receivedDoc?.value).toBe(2);
    expect(receivedNextType).toBe('function');
  });
});
