import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTailHandler, tailItemsToOtlp, type TailItem } from './tail';

function item(overrides: Partial<TailItem> = {}): TailItem {
  return {
    event: {
      request: {
        method: 'GET',
        url: 'https://shop.example/pay?x=1',
        headers: {},
      },
      response: { status: 200 },
    },
    eventTimestamp: 1000,
    logs: [],
    exceptions: [],
    scriptName: 'shop',
    scriptVersion: { id: 'v-123', tag: '1.4.2' },
    outcome: 'ok',
    cpuTime: 2,
    wallTime: 15,
    ...overrides,
  };
}

const span = (payload: ReturnType<typeof tailItemsToOtlp>, index = 0) =>
  (payload.traces.resourceSpans[index] as any).scopeSpans[0].spans[0];
const attr = (
  list: Array<{ key: string; value: Record<string, unknown> }>,
  key: string,
) => Object.values(list.find((a) => a.key === key)?.value ?? {})[0];

describe('tailItemsToOtlp', () => {
  it('turns an uncaught exception into a failed server span with the exception event', () => {
    const payload = tailItemsToOtlp([
      item({
        outcome: 'exception',
        event: {
          request: {
            method: 'POST',
            url: 'https://shop.example/pay',
            headers: {
              traceparent:
                '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            },
          },
          response: { status: 500 },
        },
        exceptions: [
          {
            timestamp: 1005,
            name: 'TypeError',
            message: 'card declined',
            stack: 'TypeError: card declined\n    at pay (index.js:9:3)',
          },
        ],
      }),
    ]);
    const s = span(payload);
    expect(s).toMatchObject({
      name: 'POST /pay',
      kind: 2,
      // Joins the caller's distributed trace, which native tracing cannot.
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
      status: { code: 2, message: 'card declined' },
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1015000000',
    });
    expect(attr(s.attributes, 'http.response.status_code')).toBe('500');
    expect(attr(s.attributes, 'cloudflare.outcome')).toBe('exception');
    expect(s.events[0].name).toBe('exception');
    expect(attr(s.events[0].attributes, 'exception.type')).toBe('TypeError');
    expect(attr(s.events[0].attributes, 'exception.stacktrace')).toContain(
      'at pay',
    );

    const resource = (payload.traces.resourceSpans[0] as any).resource
      .attributes;
    expect(attr(resource, 'service.name')).toBe('shop');
    expect(attr(resource, 'service.version')).toBe('1.4.2');
  });

  it('records console.error(err) as a handled exception on a span that succeeded', () => {
    const payload = tailItemsToOtlp([
      item({
        logs: [
          {
            timestamp: 1002,
            level: 'error',
            message: ['fallback used:', 'RangeError: out of range'],
            errorInfo: [
              null,
              {
                name: 'RangeError',
                message: 'out of range',
                stack: 'RangeError: out of range\n    at f (index.js:1:1)',
              },
            ],
          },
          { timestamp: 1003, level: 'error', message: ['plain failure', 42] },
          { timestamp: 1004, level: 'log', message: ['hello'] },
        ],
      }),
    ]);
    const s = span(payload);
    expect(s.status).toEqual({ code: 0 });
    expect(
      s.events.map((e: any) => attr(e.attributes, 'exception.type')),
    ).toEqual(['RangeError', 'Error']);
    expect(attr(s.events[1].attributes, 'exception.message')).toBe(
      'plain failure 42',
    );

    const records = (payload.logs.resourceLogs[0] as any).scopeLogs[0]
      .logRecords;
    expect(
      records.map((r: any) => [
        r.severityText,
        r.body.stringValue,
        r.traceId === s.traceId,
        r.spanId === s.spanId,
      ]),
    ).toEqual([
      ['ERROR', 'fallback used: RangeError: out of range', true, true],
      ['ERROR', 'plain failure 42', true, true],
      ['INFO', 'hello', true, true],
    ]);
  });

  it('falls back to serviceName when the event has no scriptName (wrangler dev)', () => {
    const payload = tailItemsToOtlp([item({ scriptName: null })], {
      serviceName: 'shop',
    });
    const resource = (payload.traces.resourceSpans[0] as any).resource
      .attributes;
    expect(attr(resource, 'service.name')).toBe('shop');
  });

  it('reports logging in a loop once per invocation', () => {
    const logs = Array.from({ length: 30 }, (_, i) => ({
      timestamp: 1000 + i,
      level: 'log',
      message: [`processed item ${i}`],
    }));
    const s = span(
      tailItemsToOtlp([item({ logs })], { logFloodThreshold: 10 }),
    );
    const floods = s.events.filter(
      (e: any) => attr(e.attributes, 'exception.type') === 'autotel.LogFlood',
    );
    expect(floods).toHaveLength(1);
    expect(attr(floods[0].attributes, 'exception.message')).toBe(
      '"processed item <n>" logged 10+ times in one invocation',
    );
  });

  describe('runaway alarms', () => {
    const alarmAt = (id: string, at: number) =>
      item({
        event: { scheduledTime: at },
        durableObjectId: id,
        eventTimestamp: at,
      });
    const flaggedIn = (payload: ReturnType<typeof tailItemsToOtlp>) =>
      payload.traces.resourceSpans.map((_, i) =>
        span(payload, i).events.some(
          (e: any) =>
            attr(e.attributes, 'exception.type') === 'autotel.RunawayAlarm',
        ),
      );

    it('counts when alarms ran, not when the batch arrived', () => {
      // Three alarms two minutes apart, delivered together in one batch.
      const minutes = (n: number) => 1_000_000 + n * 60_000;
      const payload = tailItemsToOtlp(
        [
          alarmAt('do-spread', minutes(0)),
          alarmAt('do-spread', minutes(2)),
          alarmAt('do-spread', minutes(4)),
        ],
        { runawayAlarm: { maxRuns: 2, windowMs: 60_000 } },
        5_000_000,
      );
      expect(flaggedIn(payload)).toEqual([false, false, false]);
    });

    it('flags a loop once even when its events arrive out of order', () => {
      const runs = [5, 4, 3, 2, 1, 0].map((n) =>
        alarmAt('do-shuffled', 2_000_000 + n * 1000),
      );
      const payload = tailItemsToOtlp(
        runs,
        { runawayAlarm: { maxRuns: 3, windowMs: 60_000 } },
        9_000_000,
      );
      expect(flaggedIn(payload).filter(Boolean)).toHaveLength(1);
    });

    afterEach(() => vi.useRealTimers());

    it('flags a Durable Object alarm firing past the limit, once per window', () => {
      const alarm = (n: number) =>
        item({
          event: { scheduledTime: n },
          durableObjectId: 'do-runaway',
          eventTimestamp: n,
        });
      const options = { runawayAlarm: { maxRuns: 3, windowMs: 60_000 } };
      const flagged = [0, 1, 2, 3, 4].map((n) =>
        span(tailItemsToOtlp([alarm(n)], options, 10_000 + n)).events.some(
          (e: any) =>
            attr(e.attributes, 'exception.type') === 'autotel.RunawayAlarm',
        ),
      );
      expect(flagged).toEqual([false, false, false, true, false]);
      expect(span(tailItemsToOtlp([alarm(9)], options, 10_009)).name).toBe(
        'alarm',
      );
    });
  });
});

describe('createTailHandler', () => {
  it('posts traces and logs to the OTLP endpoint, inside waitUntil', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending: Promise<unknown>[] = [];
    const tail = createTailHandler<{ OTLP: string; KEY: string }>({
      endpoint: (env) => env.OTLP,
      headers: (env) => ({ authorization: `Bearer ${env.KEY}` }),
    });
    await tail(
      [item({ logs: [{ timestamp: 1, level: 'info', message: ['hi'] }] })],
      { OTLP: 'https://collector.example/v1/traces', KEY: 'k' },
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://collector.example/v1/traces',
      'https://collector.example/v1/logs',
    ]);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      authorization: 'Bearer k',
    });
    vi.unstubAllGlobals();
  });
});
