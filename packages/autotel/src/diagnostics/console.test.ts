import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  trace,
  type Context,
  type ContextManager,
  type Span,
} from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { captureConsole } from './console.js';

// Span-event mode reads the active span, which needs a ContextManager.
class AlsContextManager implements ContextManager {
  private readonly als = new AsyncLocalStorage<Context>();
  active(): Context {
    return this.als.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.als.run(ctx, () =>
      fn.apply(thisArg as ThisParameterType<F>, args),
    );
  }
  bind<T>(_ctx: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    return this;
  }
}
context.setGlobalContextManager(new AlsContextManager());

const logExporter = new InMemoryLogRecordExporter();
const loggerProvider = new LoggerProvider({
  processors: [new SimpleLogRecordProcessor(logExporter)],
});
logs.setGlobalLoggerProvider(loggerProvider);

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
const tracer = tracerProvider.getTracer('console-test');

let dispose: () => void = () => {};

beforeEach(() => {
  logExporter.reset();
  spanExporter.reset();
  dispose();
  dispose = () => {};
});

afterAll(async () => {
  dispose();
  await loggerProvider.shutdown();
  await tracerProvider.shutdown();
});

const records = () => logExporter.getFinishedLogRecords();

describe('captureConsole', () => {
  it('emits a correlated log record per console call with printf formatting', () => {
    dispose = captureConsole();
    channel('console.log').publish({ args: ['hello %s', 'world', 42] });

    const all = records();
    expect(all).toHaveLength(1);
    expect(all[0]!.body).toBe('hello world 42');
    expect(all[0]!.severityNumber).toBe(SeverityNumber.INFO);
    expect(all[0]!.attributes['log.source']).toBe('console');
    expect(all[0]!.attributes['log.method']).toBe('log');
  });

  it('maps severities and honors the levels filter', () => {
    dispose = captureConsole({ levels: ['error', 'warn'] });
    channel('console.error').publish({ args: ['boom'] });
    channel('console.warn').publish({ args: ['careful'] });
    channel('console.log').publish({ args: ['ignored'] });

    const all = records();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.body === 'boom')!.severityNumber).toBe(
      SeverityNumber.ERROR,
    );
    expect(all.find((r) => r.body === 'careful')!.severityNumber).toBe(
      SeverityNumber.WARN,
    );
  });

  it('adds a span event in span-event mode', () => {
    dispose = captureConsole({ target: 'span-event' });
    const span: Span = tracer.startSpan('op', { kind: SpanKind.INTERNAL });
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      channel('console.info').publish({ args: ['inside'] });
    });
    span.end();

    expect(records()).toHaveLength(0); // span-event mode does not emit logs
    const finished = spanExporter
      .getFinishedSpans()
      .find((s) => s.name === 'op');
    expect(finished!.events.map((e) => e.name)).toContain('log');
    expect(finished!.events[0]!.attributes!['log.message']).toBe('inside');
  });

  it('stops after dispose', () => {
    const stop = captureConsole();
    stop();
    channel('console.log').publish({ args: ['after stop'] });
    expect(records()).toHaveLength(0);
  });

  it('merges static attributes', () => {
    dispose = captureConsole({ attributes: { 'service.area': 'billing' } });
    channel('console.log').publish({ args: ['x'] });
    expect(records()[0]!.attributes['service.area']).toBe('billing');
  });
});
