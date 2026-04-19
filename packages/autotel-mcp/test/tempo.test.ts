import { describe, expect, it } from 'vitest';
import {
  TempoBackend,
  buildTraceql,
  parseOtlpTrace,
} from '../src/backends/tempo/index';

describe('TempoBackend — TraceQL generation', () => {
  it('returns {} for empty query', () => {
    expect(buildTraceql({})).toBe('{}');
  });

  it('builds service + operation + error filter', () => {
    const q = buildTraceql({
      service: 'api',
      operation: 'POST /order',
      hasError: true,
    });
    expect(q).toBe(
      '{ resource.service.name = "api" && name = "POST /order" && status = error }',
    );
  });

  it('adds ms duration bounds', () => {
    const q = buildTraceql({
      service: 'api',
      minDurationMs: 100,
      maxDurationMs: 2000,
    });
    expect(q).toContain('duration >= 100ms');
    expect(q).toContain('duration <= 2000ms');
  });

  it('maps statusCode into TraceQL', () => {
    expect(buildTraceql({ statusCode: 'ERROR' })).toBe('{ status = error }');
    expect(buildTraceql({ statusCode: 'OK' })).toBe('{ status = ok }');
  });

  it('escapes quotes and backslashes in string values', () => {
    const q = buildTraceql({ service: 'weird"svc\\name' });
    expect(q).toBe('{ resource.service.name = "weird\\"svc\\\\name" }');
  });

  it('renders span-scoped tag conditions by default', () => {
    const q = buildTraceql({ tags: { 'http.method': 'POST' } });
    expect(q).toBe('{ span.http.method = "POST" }');
  });

  it('keeps resource-prefixed tags on the resource scope', () => {
    const q = buildTraceql({ tags: { 'resource.region': 'eu-west-1' } });
    expect(q).toBe('{ resource.region = "eu-west-1" }');
  });
});

describe('TempoBackend — OTLP parsing', () => {
  it('parses OTLP batches into SpanRecords with service, status, and tags', () => {
    const trace = parseOtlpTrace(
      {
        batches: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'orders' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'ignored',
                    spanId: 'span-1',
                    name: 'POST /orders',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000000100000000',
                    attributes: [
                      {
                        key: 'http.status_code',
                        value: { intValue: '500' },
                      },
                    ],
                    status: { code: 2 },
                  },
                ],
              },
            ],
          },
        ],
      },
      'trace-abc',
    );

    expect(trace).not.toBeNull();
    expect(trace!.traceId).toBe('trace-abc');
    expect(trace!.spans).toHaveLength(1);
    const span = trace!.spans[0]!;
    expect(span.serviceName).toBe('orders');
    expect(span.operationName).toBe('POST /orders');
    expect(span.durationMs).toBeCloseTo(100);
    expect(span.statusCode).toBe('ERROR');
    expect(span.hasError).toBe(true);
    expect(span.tags['http.status_code']).toBe(500);
  });

  it('falls back to instrumentationLibrarySpans for older Tempo payloads', () => {
    const trace = parseOtlpTrace(
      {
        batches: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'legacy' } },
              ],
            },
            instrumentationLibrarySpans: [
              {
                spans: [
                  {
                    traceId: 'x',
                    spanId: 'legacy-span',
                    name: 'legacy.op',
                    startTimeUnixNano: 1000,
                    endTimeUnixNano: 2000,
                  },
                ],
              },
            ],
          },
        ],
      },
      'trace-legacy',
    );
    expect(trace?.spans).toHaveLength(1);
    expect(trace?.spans[0]?.serviceName).toBe('legacy');
  });

  it('returns null when no spans are present', () => {
    expect(parseOtlpTrace({ batches: [] }, 'x')).toBeNull();
    expect(parseOtlpTrace({}, 'x')).toBeNull();
  });
});

describe('TempoBackend — wiring', () => {
  it('kind is tempo and capabilities report traces only', () => {
    const backend = new TempoBackend('http://localhost:3200');
    expect(backend.kind).toBe('tempo');
    const cap = backend.capabilities();
    expect(cap.traces).toBe('available');
    expect(cap.metrics).toBe('unsupported');
    expect(cap.logs).toBe('unsupported');
  });

  it('searchTraces sends TraceQL and unix-second time range', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ traces: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const backend = new TempoBackend('http://localhost:3200');
      const now = 1_700_000_300_000;
      await backend.searchTraces({
        service: 'api',
        hasError: true,
        startTimeUnixMs: 1_700_000_000_000,
        endTimeUnixMs: now,
      });
      const url = new URL(requests[0]!);
      expect(url.pathname).toBe('/api/search');
      expect(url.searchParams.get('q')).toContain('resource.service.name');
      expect(url.searchParams.get('q')).toContain('status = error');
      expect(url.searchParams.get('start')).toBe('1700000000');
      expect(url.searchParams.get('end')).toBe('1700000300');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('listMetrics and searchLogs report unsupported', async () => {
    const backend = new TempoBackend('http://localhost:3200');
    const metrics = await backend.listMetrics();
    expect(metrics.unsupported).toBe(true);
    const logs = await backend.searchLogs();
    expect(logs.unsupported).toBe(true);
  });

  it('listServices prefers tag-values API when available', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      requests.push(url);
      return new Response(JSON.stringify({ tagValues: ['api', 'worker'] }), {
        status: 200,
      });
    }) as typeof fetch;

    try {
      const backend = new TempoBackend('http://localhost:3200');
      const result = await backend.listServices();
      expect(result.services).toEqual(['api', 'worker']);
      expect(requests[0]).toContain('/api/search/tag/service.name/values');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
