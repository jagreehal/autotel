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
import {
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
