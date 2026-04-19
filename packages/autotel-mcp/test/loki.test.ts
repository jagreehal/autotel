import { afterEach, describe, expect, it } from 'vitest';
import { LokiBackend, buildLogQl } from '../src/backends/loki/index';

describe('LokiBackend — LogQL generation', () => {
  it('defaults to a wide service_name matcher when nothing is given', () => {
    expect(buildLogQl(undefined)).toBe('{service_name=~".+"}');
  });

  it('filters by service, severity, and free-text', () => {
    expect(
      buildLogQl({
        serviceName: 'api',
        severityText: 'ERROR',
        text: 'invalid IBAN',
      }),
    ).toBe('{service_name="api",severity_text=~"ERROR"} |= "invalid IBAN"');
  });

  it('uses traceId and spanId as plain-text filters after the stream selector', () => {
    expect(
      buildLogQl({ serviceName: 'api', traceId: 'abc', spanId: 'def' }),
    ).toBe('{service_name="api"} |= "abc" |= "def"');
  });

  it('escapes quotes in label values', () => {
    expect(buildLogQl({ serviceName: 'svc"weird' })).toBe(
      '{service_name="svc\\"weird"}',
    );
  });
});

describe('LokiBackend — wiring', () => {
  let originalFetch: typeof fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('kind is loki, capabilities report logs only', () => {
    const backend = new LokiBackend('http://localhost:3100');
    expect(backend.kind).toBe('loki');
    expect(backend.capabilities()).toEqual({
      traces: 'unsupported',
      metrics: 'unsupported',
      logs: 'available',
    });
  });

  it('searchLogs sends LogQL, nanosecond times, and parses stream entries', async () => {
    const requests: string[] = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(typeof input === 'string' ? input : input.toString());
      return new Response(
        JSON.stringify({
          status: 'success',
          data: {
            resultType: 'streams',
            result: [
              {
                stream: {
                  service_name: 'api',
                  level: 'ERROR',
                  trace_id: 'abc',
                },
                values: [
                  ['1700000000000000000', 'validation failed'],
                  ['1700000001000000000', 'retry timeout'],
                ],
              },
            ],
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const backend = new LokiBackend('http://localhost:3100');
    const result = await backend.searchLogs({
      serviceName: 'api',
      startTimeUnixMs: 1_700_000_000_000,
      endTimeUnixMs: 1_700_000_002_000,
      limit: 10,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.severityText).toBe('ERROR');
    expect(result.items[0]?.serviceName).toBe('api');
    expect(result.items[0]?.traceId).toBe('abc');

    const url = new URL(requests[0]!);
    expect(url.pathname).toBe('/loki/api/v1/query_range');
    expect(url.searchParams.get('query')).toBe('{service_name="api"}');
    expect(url.searchParams.get('start')).toBe('1700000000000000000');
    expect(url.searchParams.get('end')).toBe('1700000002000000000');
    expect(url.searchParams.get('direction')).toBe('backward');
  });
});
