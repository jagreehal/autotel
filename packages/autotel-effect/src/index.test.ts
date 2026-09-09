import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flush, init, trace } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import {
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import * as Effect from 'effect/Effect';
import type * as LogLevel from 'effect/LogLevel';
import * as References from 'effect/References';
import { layer, loggerLayer, withAutotel } from './index.js';

const exporter = createMemoryExporter();
const logExporter = new InMemoryLogRecordExporter();

beforeAll(() => {
  init({
    service: 'autotel-effect-test',
    spanExporters: [exporter],
    logRecordProcessors: [
      new SimpleLogRecordProcessor({ exporter: logExporter }),
    ],
    debug: false,
  });
});

afterEach(async () => {
  exporter.reset();
  logExporter.reset();
  await flush();
});

describe('layer', () => {
  it('exports Effect.withSpan spans through autotel', async () => {
    await Effect.runPromise(
      Effect.withSpan('todo.list')(Effect.void).pipe(
        Effect.provide(layer({ serviceName: 'svc-a' })),
      ),
    );
    await flush();

    expect(exporter.findSpan('todo.list')).toMatchObject({ name: 'todo.list' });
  });

  it('nests child spans under a parent span in one trace', async () => {
    const program = Effect.withSpan('parent')(
      Effect.withSpan('child')(Effect.void),
    );

    await Effect.runPromise(
      program.pipe(Effect.provide(layer({ serviceName: 'svc-b' }))),
    );
    await flush();

    const parent = exporter.findSpan('parent');
    const child = exporter.findSpan('child');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.traceId).toBe(parent!.traceId);
    expect(child!.parentSpanId).toBe(parent!.spanId);
  });

  it('records span attributes from withSpan options', async () => {
    await Effect.runPromise(
      Effect.withSpan('todo.get', { attributes: { 'todo.id': 'abc' } })(
        Effect.void,
      ).pipe(Effect.provide(layer({ serviceName: 'svc-c' }))),
    );
    await flush();

    expect(exporter.findSpan('todo.get')?.attributes['todo.id']).toBe('abc');
  });
});

describe('withAutotel', () => {
  it('nests the Effect span under the surrounding autotel span', async () => {
    await trace.run('http.get', async () => {
      await Effect.runPromise(
        withAutotel(
          Effect.withSpan('todo.list')(Effect.void).pipe(
            Effect.provide(layer({ serviceName: 'svc-d' })),
          ),
        ),
      );
    });
    await flush();

    const root = exporter.findSpan('http.get');
    const child = exporter.findSpan('todo.list');
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.traceId).toBe(root!.traceId);
    expect(child!.parentSpanId).toBe(root!.spanId);
  });

  it('reads the surrounding span when the effect runs, not when it is built', async () => {
    // A program built once at module scope and run per request is the shape
    // that matters: the parent has to be whatever span is active at run time.
    const program = withAutotel(
      Effect.withSpan('todo.count')(Effect.void).pipe(
        Effect.provide(layer({ serviceName: 'svc-e' })),
      ),
    );

    await trace.run('http.count', async () => {
      await Effect.runPromise(program);
    });
    await flush();

    const root = exporter.findSpan('http.count');
    const child = exporter.findSpan('todo.count');
    expect(child!.traceId).toBe(root!.traceId);
    expect(child!.parentSpanId).toBe(root!.spanId);
  });

  it('runs unchanged when nothing is traced around it', async () => {
    await Effect.runPromise(
      withAutotel(
        Effect.withSpan('todo.orphan')(Effect.void).pipe(
          Effect.provide(layer({ serviceName: 'svc-f' })),
        ),
      ),
    );
    await flush();

    expect(exporter.findSpan('todo.orphan')?.parentSpanId).toBeUndefined();
  });
});

type LogRecord = Record<string, unknown>;

async function captureLogs(
  effect: Effect.Effect<unknown, unknown, never>,
): Promise<LogRecord[]> {
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });

  try {
    await Effect.runPromise(Effect.exit(effect));
  } finally {
    spy.mockRestore();
  }
  await flush();

  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as LogRecord];
    } catch {
      return [];
    }
  });
}

describe('layer', () => {
  it('bridges spans and logs from one call', async () => {
    const records = await captureLogs(
      Effect.withSpan('order.refund')(Effect.log('refunded')).pipe(
        Effect.provide(layer({ serviceName: 'svc-both' })),
      ),
    );

    const span = exporter.findSpan('order.refund')!;
    expect(span).toBeDefined();
    expect(records.find((r) => r.msg === 'refunded')).toMatchObject({
      service: 'svc-both',
      traceId: span.traceId,
    });
    expect(
      logExporter.getFinishedLogRecords().find((e) => e.body === 'refunded'),
    ).toBeDefined();
  });

  it('bridges spans only with logs: false', async () => {
    const records = await captureLogs(
      Effect.withSpan('order.void')(Effect.log('voided')).pipe(
        Effect.provide(layer({ serviceName: 'svc-spans', logs: false })),
      ),
    );

    expect(exporter.findSpan('order.void')).toBeDefined();
    expect(records.find((r) => r.msg === 'voided')).toBeUndefined();
    expect(
      logExporter.getFinishedLogRecords().find((e) => e.body === 'voided'),
    ).toBeUndefined();
  });

  it('passes logger options through', async () => {
    const records = await captureLogs(
      Effect.logDebug('verbose').pipe(
        Effect.provide(
          layer({ serviceName: 'svc-opts', logs: { level: 'debug' } }),
        ),
        Effect.provideService(
          References.MinimumLogLevel,
          'Trace' as LogLevel.LogLevel,
        ),
      ),
    );

    expect(records.find((r) => r.msg === 'verbose')).toMatchObject({
      level: 'debug',
    });
  });
});

describe('loggerLayer', () => {
  it('routes Effect logs through autotel with the surrounding trace id', async () => {
    const records = await captureLogs(
      Effect.withSpan('order.pay')(
        Effect.log('charged').pipe(Effect.annotateLogs({ 'order.id': 'o-1' })),
      ).pipe(Effect.provide(layer({ serviceName: 'svc-log' }))),
    );

    const span = exporter.findSpan('order.pay')!;
    expect(records.find((r) => r.msg === 'charged')).toMatchObject({
      level: 'info',
      service: 'svc-log',
      'order.id': 'o-1',
      traceId: span.traceId,
      spanId: span.spanId,
    });
  });

  it('emits an OTel log record correlated to the enclosing span', async () => {
    await captureLogs(
      Effect.withSpan('order.ship')(
        Effect.log('shipped').pipe(Effect.annotateLogs({ 'order.id': 'o-2' })),
      ).pipe(Effect.provide(layer({ serviceName: 'svc-otlp' }))),
    );

    const span = exporter.findSpan('order.ship')!;
    const record = logExporter
      .getFinishedLogRecords()
      .find((entry) => entry.body === 'shipped');

    expect(record).toBeDefined();
    expect(record!.severityText).toBe('Info');
    expect(record!.attributes['order.id']).toBe('o-2');
    expect(record!.spanContext?.traceId).toBe(span.traceId);
    expect(record!.spanContext?.spanId).toBe(span.spanId);
  });

  it('flattens rich annotation values onto the log record', async () => {
    await captureLogs(
      Effect.log('annotated').pipe(
        Effect.annotateLogs({
          when: new Date(0),
          order: { id: 7, tags: ['a', 'b'] },
          seats: new Map([['1a', 'taken']]),
        }),
        Effect.provide(
          loggerLayer({ serviceName: 'svc-attrs', console: false }),
        ),
      ),
    );

    const record = logExporter
      .getFinishedLogRecords()
      .find((entry) => entry.body === 'annotated');

    expect(record!.attributes).toMatchObject({
      when: '1970-01-01T00:00:00.000Z',
      'order.id': 7,
      'order.tags': ['a', 'b'],
      'seats.1a': 'taken',
    });
  });

  it('emits a log record even with console output disabled', async () => {
    const records = await captureLogs(
      Effect.log('silent').pipe(
        Effect.provide(
          loggerLayer({ serviceName: 'svc-quiet-console', console: false }),
        ),
      ),
    );

    expect(records.find((r) => r.msg === 'silent')).toBeUndefined();
    expect(
      logExporter.getFinishedLogRecords().find((e) => e.body === 'silent'),
    ).toBeDefined();
  });

  it('logs the failure cause as err', async () => {
    const records = await captureLogs(
      Effect.logError('payment failed', new Error('card declined')).pipe(
        Effect.provide(loggerLayer({ serviceName: 'svc-err' })),
      ),
    );

    const record = records.find(
      (r) => r.msg === 'payment failed Error: card declined',
    );
    expect(record).toMatchObject({ level: 'error' });
    expect(String(record?.err)).toContain('card declined');
  });

  it('logs a Cause passed to logError as err', async () => {
    const records = await captureLogs(
      Effect.fail(new Error('boom')).pipe(
        Effect.catchCause((cause) => Effect.logError('handler failed', cause)),
        Effect.provide(loggerLayer({ serviceName: 'svc-cause' })),
      ),
    );

    // The Cause is stripped from the message parts by Effect and surfaces on
    // `Logger.Options.cause`, so `msg` stays clean and the detail lands in err.
    const record = records.find((r) => r.msg === 'handler failed');
    expect(record).toMatchObject({ level: 'error' });
    expect(String(record?.err)).toContain('boom');
  });

  it('replaces the default console logger by default', async () => {
    const records = await captureLogs(
      Effect.log('once').pipe(
        Effect.provide(loggerLayer({ serviceName: 'svc-replace' })),
      ),
    );

    expect(records.filter((r) => r.msg === 'once')).toHaveLength(1);
    expect(records.some((r) => r.service === 'svc-replace')).toBe(true);
  });

  it('keeps the default console logger with mergeWithExisting', async () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

    try {
      await Effect.runPromise(
        Effect.log('twice').pipe(
          Effect.provide(
            loggerLayer({
              serviceName: 'svc-merge',
              mergeWithExisting: true,
            }),
          ),
        ),
      );
    } finally {
      spy.mockRestore();
    }

    // One structured line from autotel, one human-readable line from Effect.
    expect(lines.filter((line) => line.includes('twice'))).toHaveLength(2);
    expect(lines.some((line) => line.includes('"service":"svc-merge"'))).toBe(
      true,
    );
  });

  it.each([
    ['logWarning', 'warn'],
    ['logError', 'error'],
    ['logFatal', 'error'],
  ] as const)('maps %s to autotel level %s', async (method, expected) => {
    const records = await captureLogs(
      Effect[method]('mapped').pipe(
        Effect.provide(loggerLayer({ serviceName: 'svc-level' })),
      ),
    );

    expect(records.find((r) => r.msg === 'mapped')).toMatchObject({
      level: expected,
    });
  });

  it.each([
    ['logDebug', 'debug'],
    ['logTrace', 'debug'],
  ] as const)(
    'maps %s to autotel level %s when the level allows it',
    async (method, expected) => {
      const records = await captureLogs(
        Effect[method]('verbose').pipe(
          Effect.provide(
            loggerLayer({ serviceName: 'svc-verbose', level: 'debug' }),
          ),
          Effect.provideService(
            References.MinimumLogLevel,
            'Trace' as LogLevel.LogLevel,
          ),
        ),
      );

      expect(records.find((r) => r.msg === 'verbose')).toMatchObject({
        level: expected,
      });
    },
  );

  it('drops debug logs at the default level', async () => {
    const records = await captureLogs(
      Effect.logDebug('quiet').pipe(
        Effect.provide(loggerLayer({ serviceName: 'svc-quiet' })),
        Effect.provideService(
          References.MinimumLogLevel,
          'Trace' as LogLevel.LogLevel,
        ),
      ),
    );

    expect(records.find((r) => r.msg === 'quiet')).toBeUndefined();
  });

  it('joins non-string message parts', async () => {
    const records = await captureLogs(
      Effect.log('order', { id: 'o-9' }, 42).pipe(
        Effect.provide(loggerLayer({ serviceName: 'svc-msg' })),
      ),
    );

    expect(
      records.find((r) => typeof r.msg === 'string' && r.msg.includes('o-9')),
    ).toMatchObject({ msg: 'order {"id":"o-9"} 42' });
  });
});
