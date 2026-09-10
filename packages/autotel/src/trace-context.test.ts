import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  INVALID_SPAN_CONTEXT,
  trace as otelTrace,
  type Attributes,
} from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { createTraceContext, enterOrRun } from './trace-context';
import type { TraceContext } from './trace-context';

type Box<T> = { value: T };

/** The part of AsyncLocalStorage that `enterOrRun` reaches for. */
interface FakeStorage<T> {
  enterWith?: (store: Box<T>) => void;
  getStore: () => Box<T> | undefined;
  run: (store: Box<T>, fn: () => void) => void;
}

/**
 * The fake as the AsyncLocalStorage `enterOrRun` is declared to take.
 */
function asStorage<T>(storage: FakeStorage<T>): never {
  // SAFETY: `enterOrRun` calls getStore, run and - where the runtime has one -
  // enterWith. Nothing else on AsyncLocalStorage is reachable from there.
  return storage as never;
}

function createFakeStorage<T>(initialValue?: T) {
  let currentStore: Box<T> | undefined =
    initialValue === undefined ? undefined : { value: initialValue };
  const runCalls: Array<Box<T>> = [];
  const enterWithCalls: Array<Box<T>> = [];

  const storage: FakeStorage<T> = {
    getStore() {
      return currentStore;
    },
    run(store: Box<T>, fn: () => void) {
      runCalls.push(store);
      const previousStore = currentStore;
      currentStore = store;
      try {
        fn();
      } finally {
        currentStore = previousStore;
      }
    },
    enterWith(store: Box<T>) {
      enterWithCalls.push(store);
      currentStore = store;
    },
  };

  return {
    enterWithCalls,
    runCalls,
    storage,
  };
}

describe('enterOrRun', () => {
  it('mutates the existing store when already inside a run scope', () => {
    const { storage } = createFakeStorage('outer');

    enterOrRun(asStorage(storage), 'updated');

    expect(storage.getStore()?.value).toBe('updated');
  });

  it('falls back to run() when enterWith throws', () => {
    const { runCalls, storage } = createFakeStorage<string>();
    storage.enterWith = () => {
      throw new Error('enterWith not supported');
    };

    enterOrRun(asStorage(storage), 'worker-value');

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.value).toBe('worker-value');
  });

  it('prefers enterWith() when no store exists and the runtime supports it', () => {
    const { enterWithCalls, storage } = createFakeStorage<string>();

    enterOrRun(asStorage(storage), 'node-value');

    expect(enterWithCalls).toHaveLength(1);
    expect(enterWithCalls[0]?.value).toBe('node-value');
    expect(storage.getStore()?.value).toBe('node-value');
  });
});

describe('createTraceContext attributes', () => {
  function recordAttributes(set: (ctx: TraceContext) => void) {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const span = provider.getTracer('test').startSpan('op');
    set(createTraceContext(span));
    span.end();
    return exporter.getFinishedSpans()[0]!.attributes;
  }

  it('flattens a nested object into dot-notation attributes', () => {
    const attributes = recordAttributes((ctx) => {
      ctx.setAttribute('client-rights', {
        admin: true,
        reports: { view: true, export: false },
      });
    });

    expect(attributes).toEqual({
      'client-rights.admin': true,
      'client-rights.reports.view': true,
      'client-rights.reports.export': false,
    });
  });

  it('flattens rich values inside setAttributes', () => {
    const attributes = recordAttributes((ctx) => {
      ctx.setAttributes({
        'user.id': 'u_1',
        user: new Map([['plan', 'pro']]),
        tags: new Set(['a', 'b']),
      });
    });

    expect(attributes).toEqual({
      'user.id': 'u_1',
      'user.plan': 'pro',
      tags: ['a', 'b'],
    });
  });

  // An attribute setter is called from application code paths; a value it
  // cannot represent must never be what takes the request down.
  it('never throws on a value it cannot convert', () => {
    let attributes: Attributes = {};

    expect(() => {
      attributes = recordAttributes((ctx) => {
        ctx.setAttribute('at', new Date('nonsense'));
        ctx.setAttributes({ also: new Date('nonsense') });
      });
    }).not.toThrow();

    expect(attributes).toEqual({
      at: '<invalid-date>',
      also: '<invalid-date>',
    });
  });

  // The bag's own values are read by the conversion, never before it: a getter
  // that throws is one key's problem, not the caller's.
  it('never throws on a bag whose getter throws', () => {
    const attrs = {
      ok: 1,
      get boom(): string {
        throw new Error('getter exploded');
      },
    };
    let attributes: Attributes = {};

    expect(() => {
      attributes = recordAttributes((ctx) => ctx.setAttributes(attrs));
    }).not.toThrow();

    expect(attributes).toEqual({ ok: 1, boom: '<serialization-failed>' });
  });

  it('never throws on a bag that refuses to be listed', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('enumeration exploded');
        },
      },
    );

    expect(() =>
      recordAttributes((ctx) => ctx.setAttributes(hostile)),
    ).not.toThrow();
  });

  it('names a non-finite number rather than encoding one', () => {
    // OTLP/JSON writes NaN as `null`, which a collector reads back as a
    // confident 0. A marker says the measurement failed.
    const attributes = recordAttributes((ctx) => {
      ctx.setAttribute('ratio', Number.NaN);
      ctx.setAttributes({ ceiling: Number.POSITIVE_INFINITY });
    });

    expect(attributes).toEqual({
      ratio: '<invalid-number>',
      ceiling: '<invalid-number>',
    });
  });

  it('never throws on a non-recording span either', () => {
    const nonRecording = otelTrace.wrapSpanContext(INVALID_SPAN_CONTEXT);
    const ctx = createTraceContext(nonRecording);

    expect(() => ctx.setAttribute('at', new Date('nonsense'))).not.toThrow();
    expect(() => ctx.setAttributes({ at: new Date('nonsense') })).not.toThrow();
    expect(() =>
      ctx.setAttributes({
        get boom(): string {
          throw new Error('getter exploded');
        },
      }),
    ).not.toThrow();
  });

  it('leaves scalars and homogeneous arrays exactly as they were', () => {
    const attributes = recordAttributes((ctx) => {
      ctx.setAttribute('retries', 3);
      ctx.setAttribute('cache.hit', false);
      ctx.setAttribute('regions', ['eu-west-1', 'us-east-1']);
      ctx.setAttributes({ 'http.route': '/users/:id' });
    });

    expect(attributes).toEqual({
      retries: 3,
      'cache.hit': false,
      regions: ['eu-west-1', 'us-east-1'],
      'http.route': '/users/:id',
    });
  });
});
