import { describe, it, expect, beforeEach } from 'vitest';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import {
  installConsoleSignals,
  logTemplate,
  LOG_FLOOD_EXCEPTION,
} from './console-signals';

const exporter = new InMemorySpanExporter();
const tracer = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
}).getTracer('test');

function inSpan(fn: () => void): ReadableSpan {
  exporter.reset();
  const span = tracer.startSpan('op');
  context.with(trace.setSpan(context.active(), span), fn);
  span.end();
  return exporter.getFinishedSpans()[0]!;
}

const exceptions = (span: ReadableSpan) =>
  span.events.filter((e) => e.name === 'exception').map((e) => e.attributes!);

// Keep test output quiet: the channel fires before the stream write.
const silently = (fn: () => void) => () => {
  const write = process.stderr.write;
  const out = process.stdout.write;
  process.stderr.write = () => true;
  process.stdout.write = () => true;
  try {
    fn();
  } finally {
    process.stderr.write = write;
    process.stdout.write = out;
  }
};

describe('console signals', () => {
  beforeEach(() => installConsoleSignals({ logFloodThreshold: 10 }));

  it('records console.error(Error) without changing status', () => {
    let span!: ReadableSpan;
    silently(() => {
      span = inSpan(() => console.error('failed', new RangeError('boom')));
    })();
    expect(exceptions(span)).toEqual([
      expect.objectContaining({
        'exception.type': 'RangeError',
        'exception.message': 'boom',
      }),
    ]);
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records a formatted, bounded string otherwise', () => {
    let span!: ReadableSpan;
    silently(() => {
      span = inSpan(() => console.error('bad %s', 'input', 'x'.repeat(600)));
    })();
    const message = String(exceptions(span)[0]!['exception.message']);
    expect(message.startsWith('bad input xxx')).toBe(true);
    expect(message.length).toBe(500);
  });

  it("ignores autotel's own logs and re-entrant console calls", () => {
    let span!: ReadableSpan;
    silently(() => {
      span = inSpan(() => {
        console.error('[autotel] internal');
        const active = trace.getActiveSpan()!;
        const record = active.recordException.bind(active);
        active.recordException = (e) => {
          console.error('re-entrant');
          record(e);
        };
        console.error('once');
      });
    })();
    expect(exceptions(span).map((e) => e['exception.message'])).toEqual([
      'once',
    ]);
  });

  it('honours captureConsoleErrors: false', () => {
    installConsoleSignals({ captureConsoleErrors: false });
    let span!: ReadableSpan;
    silently(() => {
      span = inSpan(() => console.error('quiet'));
    })();
    expect(exceptions(span)).toEqual([]);
  });

  it('fires autotel.LogFlood once per trace past the threshold', () => {
    let span!: ReadableSpan;
    silently(() => {
      span = inSpan(() => {
        for (let i = 0; i < 50; i++) console.log(`row ${i} done`);
        for (let i = 0; i < 5; i++) console.info(`other ${i}`);
      });
    })();
    expect(exceptions(span)).toEqual([
      expect.objectContaining({
        'exception.type': LOG_FLOOD_EXCEPTION,
        'exception.message':
          '"row <n> done" logged 10+ times in one invocation',
      }),
    ]);
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('normalises uuids, hex ids and digits', () => {
    expect(
      logTemplate([
        'job 7 for 3f2a9c1e-1b2c-4d5e-8f90-123456789abc sha 0a1b2c3d4e',
        { a: 1 },
      ]),
    ).toBe('job <n> for <uuid> sha <hex> <object>');
  });
});
