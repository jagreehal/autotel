import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JaegerBackend } from '../src/backends/jaeger/index';
import { installFetchHandler } from './helpers/fetch';

const BASE = 'http://jaeger.local';
const NOT_FOUND = () => new Response('404 page not found', { status: 404 });
const json = <Body>(body: Body) =>
  new Response(JSON.stringify(body), { status: 200 });

/** The shape Jaeger 2.22 returned for a two-trace search: one `resourceSpans` per trace. */
function otlpTrace(traceId: string, service: string, error = false) {
  const span = (spanId: string, parentSpanId: string | undefined) => ({
    traceId,
    spanId,
    parentSpanId,
    flags: 769,
    name: parentSpanId ? 'Health/Check' : 'check-orders',
    kind: parentSpanId ? 2 : 1,
    startTimeUnixNano: '1793778797875040000',
    endTimeUnixNano: '1793778797875219000',
    attributes: [{ key: 'rpc.system', value: { stringValue: 'grpc' } }],
    status: error ? { code: 2 } : {},
  });
  return {
    resource: {
      attributes: [{ key: 'service.name', value: { stringValue: service } }],
    },
    scopeSpans: [
      {
        spans: [
          span('b5021ba32a88e202', '76142cb8190172c2'),
          span('76142cb8190172c2', undefined),
        ],
      },
    ],
  };
}

const TRACE_A = '48b67531613991752ce29ee43154c840';
const TRACE_B = '58b67531613991752ce29ee43154c841';

describe('JaegerBackend on a server with only /api/v3 (Jaeger 2.22)', () => {
  let originalFetch: typeof fetch;
  let calls: string[];

  /** Answers like 2.22: the old routes are gone, `v3` answers the rest. */
  function serve(v3: (url: URL) => Response) {
    installFetchHandler(async (url) => {
      calls.push(url);
      const parsed = new URL(url);
      return parsed.pathname.startsWith('/api/v3/') ? v3(parsed) : NOT_FOUND();
    });
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('lists services, and stops asking the old API once it knows', async () => {
    serve(() => json({ services: ['orders', 'payments'] }));
    const backend = new JaegerBackend(BASE);

    expect(await backend.listServices()).toEqual({
      services: ['orders', 'payments'],
    });
    await backend.listServices();

    expect(calls).toEqual([
      `${BASE}/api/services`,
      `${BASE}/api/v3/services`,
      `${BASE}/api/v3/services`,
    ]);
  });

  it('reports healthy', async () => {
    serve(() => json({ services: ['orders'] }));

    const health = await new JaegerBackend(BASE).healthCheck();

    expect(health.healthy).toBe(true);
  });

  it('lists operations once each, though v3 repeats a name per span kind', async () => {
    serve(() =>
      json({
        operations: [
          { name: 'check', spanKind: 'server' },
          { name: 'check', spanKind: 'client' },
          { name: 'other', spanKind: 'internal' },
        ],
      }),
    );

    const result = await new JaegerBackend(BASE).listOperations('a b');

    expect(result.operations).toEqual(['check', 'other']);
    expect(calls.at(-1)).toBe(`${BASE}/api/v3/operations?service=a+b`);
  });

  it('groups a search by trace and keeps the parent links', async () => {
    serve(() =>
      json({
        result: {
          resourceSpans: [
            otlpTrace(TRACE_A, 'orders'),
            otlpTrace(TRACE_B, 'orders'),
          ],
        },
      }),
    );

    const { items } = await new JaegerBackend(BASE).searchTraces({
      service: 'orders',
    });

    expect(items.map((trace) => trace.traceId)).toEqual([TRACE_A, TRACE_B]);
    const server = items[0]?.spans.find(
      (s) => s.operationName === 'Health/Check',
    );
    expect(server?.parentSpanId).toBe('76142cb8190172c2');
    expect(server?.serviceName).toBe('orders');
    expect(server?.tags['rpc.system']).toBe('grpc');
  });

  it.each(['1793778797875100000', '1793778797875800000'])(
    'preserves a 0.4 ms duration starting at %s through duration filtering',
    async (startTimeUnixNano) => {
      const resource = otlpTrace(TRACE_A, 'orders');
      for (const span of resource.scopeSpans[0].spans) {
        span.startTimeUnixNano = startTimeUnixNano;
        span.endTimeUnixNano = (
          BigInt(startTimeUnixNano) + 400_000n
        ).toString();
      }
      serve(() => json({ result: { resourceSpans: [resource] } }));

      const { items } = await new JaegerBackend(BASE).searchTraces({
        service: 'orders',
        minDurationMs: 0.3,
        maxDurationMs: 0.5,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.spans.map((span) => span.durationMs)).toEqual([
        0.4, 0.4,
      ]);
    },
  );

  it('keeps a nested trace within its fractional duration bound', async () => {
    const resource = otlpTrace(TRACE_A, 'orders');
    const [child, parent] = resource.scopeSpans[0].spans;
    parent.startTimeUnixNano = '1793778797875800000';
    parent.endTimeUnixNano = '1793778797876200000';
    child.startTimeUnixNano = '1793778797876000000';
    child.endTimeUnixNano = '1793778797876100000';
    serve(() => json({ result: { resourceSpans: [resource] } }));

    const backend = new JaegerBackend(BASE);
    const { items } = await backend.searchTraces({
      service: 'orders',
      minDurationMs: 0.3,
      maxDurationMs: 0.5,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.spans.map((span) => span.durationMs)).toEqual([0.1, 0.4]);
    expect(items[0]?.spans[1]?.startTimeUnixMs).toBe(1793778797875.8);
    expect(
      (await backend.searchTraces({ service: 'orders', maxDurationMs: 0.3 }))
        .items,
    ).toHaveLength(0);
  });

  it('sends both time bounds, as RFC 3339, with every filter', async () => {
    serve(() => json({ result: { resourceSpans: [] } }));

    await new JaegerBackend(BASE).searchTraces({
      service: 'orders',
      operation: 'GET /a',
      minDurationMs: 5,
      maxDurationMs: 50,
      limit: 3,
      startTimeUnixMs: Date.UTC(2026, 0, 1),
      endTimeUnixMs: Date.UTC(2026, 0, 2),
    });

    const params = new URL(calls.at(-1) ?? '').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      'query.service_name': 'orders',
      'query.operation_name': 'GET /a',
      'query.num_traces': '3',
      'query.start_time_min': '2026-01-01T00:00:00.000Z',
      'query.start_time_max': '2026-01-02T00:00:00.000Z',
      'query.duration_min': '5ms',
      'query.duration_max': '50ms',
    });
  });

  it('defaults to the last hour, because v3 refuses an open-ended search', async () => {
    serve(() => json({ result: { resourceSpans: [] } }));

    await new JaegerBackend(BASE).searchTraces({ service: 'orders' });

    const params = new URL(calls.at(-1) ?? '').searchParams;
    const start = Date.parse(params.get('query.start_time_min') ?? '');
    const end = Date.parse(params.get('query.start_time_max') ?? '');
    expect(end - start).toBe(60 * 60 * 1000);
  });

  it('applies hasError after the search, as the old path does', async () => {
    serve(() =>
      json({
        result: {
          resourceSpans: [
            otlpTrace(TRACE_A, 'orders'),
            otlpTrace(TRACE_B, 'orders', true),
          ],
        },
      }),
    );

    const { items } = await new JaegerBackend(BASE).searchTraces({
      service: 'orders',
      hasError: true,
    });

    expect(items.map((trace) => trace.traceId)).toEqual([TRACE_B]);
  });

  it('reads "No traces found" as an empty result, because v3 sends it as a 404', async () => {
    serve(
      () =>
        new Response('{"error":{"httpCode":404,"message":"No traces found"}}', {
          status: 404,
        }),
    );

    const result = await new JaegerBackend(BASE).searchTraces({
      service: 'orders',
    });

    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('still fails when /api/v3 is missing too, instead of claiming no traces', async () => {
    serve(() => NOT_FOUND());

    await expect(
      new JaegerBackend(BASE).searchTraces({ service: 'orders' }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('JaegerBackend on a server with the old API', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('never touches /api/v3', async () => {
    const calls: string[] = [];
    installFetchHandler(async (url) => {
      calls.push(url);
      return json({ data: [] });
    });
    const backend = new JaegerBackend(BASE);

    await backend.listServices();
    await backend.listOperations('orders');
    await backend.searchTraces({ service: 'orders' });

    expect(calls).toHaveLength(3);
    expect(calls.some((url) => url.includes('/api/v3'))).toBe(false);
  });

  it('does not treat a 500 as a reason to switch API', async () => {
    const calls: string[] = [];
    installFetchHandler(async (url) => {
      calls.push(url);
      return new Response('server error', { status: 500 });
    });

    await expect(new JaegerBackend(BASE).listServices()).rejects.toThrow(
      /HTTP 500/,
    );
    expect(calls).toEqual([`${BASE}/api/services`]);
  });
});
