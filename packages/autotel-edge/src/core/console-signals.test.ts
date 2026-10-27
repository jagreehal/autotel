import { describe, it, expect, vi, beforeAll } from 'vitest';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { parseConfig, setConfig } from './config';
import { logTemplate, LOG_FLOOD_EXCEPTION } from './console-signals';
import { getExecutionLogger } from '../execution-logger';
import { createTraceContext } from './trace-context';
import {
  createNativeSpanShim,
  createNativeTraceContext,
  runWithNativeTraceContext,
  type NativeSpanHandle,
} from './native-bridge';

const exporter = new InMemorySpanExporter();
const tracer = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
}).getTracer('test');

const errorSpy = vi.fn();
const logSpy = vi.fn();

beforeAll(() => {
  // The patch wraps whatever console holds when it installs.
  console.error = errorSpy;
  console.log = logSpy;
  parseConfig({ service: { name: 'console-signals' } });
});

function inSpan(fn: () => void, config = {}): ReadableSpan {
  exporter.reset();
  const ctx = setConfig(
    parseConfig({ service: { name: 'console-signals' }, ...config }),
  );
  context.with(ctx, () => {
    const span = tracer.startSpan('op');
    context.with(trace.setSpan(context.active(), span), fn);
    span.end();
  });
  return exporter.getFinishedSpans()[0]!;
}

const exceptions = (span: ReadableSpan) =>
  span.events.filter((e) => e.name === 'exception').map((e) => e.attributes!);

describe('console.error capture', () => {
  it('records the Error on the active span and leaves status unset', () => {
    const span = inSpan(() => console.error('failed:', new TypeError('boom')));
    expect(exceptions(span)).toEqual([
      expect.objectContaining({
        'exception.type': 'TypeError',
        'exception.message': 'boom',
      }),
    ]);
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(errorSpy).toHaveBeenCalledWith('failed:', expect.any(TypeError));
  });

  it('records a formatted, bounded message when no Error is passed', () => {
    const span = inSpan(() => console.error('bad', { id: 1 }, 'x'.repeat(600)));
    const message = String(exceptions(span)[0]!['exception.message']);
    expect(message.startsWith('bad {"id":1} xxx')).toBe(true);
    expect(message.length).toBe(500);
  });

  it("ignores autotel's own messages and recursion from recording", () => {
    const span = inSpan(() => {
      console.error('[autotel-edge] Exporter error:', 'nope');
      const active = trace.getActiveSpan()!;
      const record = active.recordException.bind(active);
      active.recordException = (e) => {
        console.error('re-entrant'); // must not recurse
        record(e);
      };
      console.error('once');
    });
    expect(exceptions(span).map((e) => e['exception.message'])).toEqual([
      'once',
    ]);
  });

  it('log.error() reaches console.error but records its exception once', () => {
    const error = new Error('handled');
    const span = inSpan(() => getExecutionLogger().error(error));
    expect(exceptions(span)).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(error);
  });

  it('log.error() under native tracing records natively and writes no console line', () => {
    const recorded: unknown[] = [];
    const handle: NativeSpanHandle = {
      isTraced: true,
      setAttribute() {},
      setAttributes() {},
      setStatus: vi.fn(),
      recordException: (e) => recorded.push(e),
      updateName() {},
    };
    errorSpy.mockClear();
    const error = new Error('handled natively');
    runWithNativeTraceContext(
      createNativeTraceContext(handle, 'handler', 'ray-1'),
      () => getExecutionLogger().error(error),
    );
    expect(recorded).toEqual([error]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('log.error() falls back to console.error on a native span without recordException', () => {
    const attributes: Record<string, unknown> = {};
    const handle: NativeSpanHandle = {
      isTraced: true,
      setAttribute: (key, value) => {
        attributes[key] = value;
      },
    };
    errorSpy.mockClear();
    const error = new Error('older runtime');
    runWithNativeTraceContext(
      createNativeTraceContext(handle, 'handler', 'ray-1'),
      () => getExecutionLogger().error(error),
    );
    expect(attributes['exception.message']).toBe('older runtime');
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('log.error() on an explicit non-native target still writes console.error under native tracing', () => {
    const handle: NativeSpanHandle = {
      isTraced: true,
      setAttribute() {},
      recordException: vi.fn(),
    };
    errorSpy.mockClear();
    const error = new Error('explicit target');
    const span = inSpan(() => {
      const otelTarget = createTraceContext(trace.getActiveSpan()!);
      runWithNativeTraceContext(
        createNativeTraceContext(handle, 'handler', 'ray-1'),
        () => getExecutionLogger(otelTarget).error(error),
      );
    });
    expect(exceptions(span)).toHaveLength(1);
    expect(handle.recordException).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(error);
  });

  it.each([
    ['records natively and writes no console line', true],
    ['falls back to console.error without native recordException', false],
  ])(
    'log.error() on the OTel span shim of a native span %s',
    (_label, hasRecordException) => {
      const recorded: unknown[] = [];
      const handle: NativeSpanHandle = {
        isTraced: true,
        setAttribute() {},
        ...(hasRecordException
          ? { recordException: (e: unknown) => recorded.push(e) }
          : {}),
      };
      errorSpy.mockClear();
      const error = new Error('via the shim');
      const shim = createNativeSpanShim(handle, 'ray-1');
      context.with(trace.setSpan(context.active(), shim), () =>
        getExecutionLogger().error(error),
      );
      expect(recorded).toEqual(hasRecordException ? [error] : []);
      expect(errorSpy).toHaveBeenCalledTimes(hasRecordException ? 0 : 1);
    },
  );

  it('respects captureConsoleErrors: false', () => {
    const span = inSpan(() => console.error('quiet'), {
      captureConsoleErrors: false,
    });
    expect(exceptions(span)).toEqual([]);
  });

  it('does nothing outside a span', () => {
    expect(() => console.error('no span')).not.toThrow();
  });

  it('lands on the native span under native tracing', () => {
    const recorded: unknown[] = [];
    const handle: NativeSpanHandle = {
      isTraced: true,
      setAttribute() {},
      setAttributes() {},
      setStatus: vi.fn(),
      recordException: (e) => recorded.push(e),
      updateName() {},
    };
    runWithNativeTraceContext(
      createNativeTraceContext(handle, 'handler', 'ray-1'),
      () => console.error(new Error('native boom')),
    );
    expect(recorded).toEqual([
      expect.objectContaining({ name: 'Error', message: 'native boom' }),
    ]);
    expect(handle.setStatus).not.toHaveBeenCalled();
  });
});

describe('log flood', () => {
  it('normalises ids and numbers into one template', () => {
    expect(
      logTemplate([
        'user 42 order 3f2a9c1e-1b2c-4d5e-8f90-123456789abc hash deadbeef01',
      ]),
    ).toBe('user <n> order <uuid> hash <hex>');
  });

  it('fires once per invocation when a template passes the threshold', () => {
    const span = inSpan(
      () => {
        for (let i = 0; i < 50; i++) console.log(`item ${i}`);
      },
      { logFloodThreshold: 10 },
    );
    const floods = exceptions(span).filter(
      (e) => e['exception.type'] === LOG_FLOOD_EXCEPTION,
    );
    expect(floods).toEqual([
      expect.objectContaining({
        'exception.message': '"item <n>" logged 10+ times in one invocation',
      }),
    ]);
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(logSpy).toHaveBeenCalledTimes(50);
  });

  it('stays quiet under the threshold and when disabled', () => {
    const under = inSpan(
      () => {
        for (let i = 0; i < 10; i++) console.log(`item ${i}`);
      },
      { logFloodThreshold: 10 },
    );
    const off = inSpan(
      () => {
        for (let i = 0; i < 200; i++) console.log(`item ${i}`);
      },
      { logFloodThreshold: 0 },
    );
    expect(exceptions(under)).toEqual([]);
    expect(exceptions(off)).toEqual([]);
  });
});
