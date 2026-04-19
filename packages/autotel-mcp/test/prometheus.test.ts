import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrometheusBackend } from '../src/backends/prometheus/index';

type FetchCall = { url: string };

function installFetchStub(
  respond: (url: string) => { status?: number; body: unknown },
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url });
    const { status = 200, body } = respond(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('PrometheusBackend', () => {
  let stub: ReturnType<typeof installFetchStub>;
  afterEach(() => stub?.restore());

  it('kind is prometheus, capabilities report metrics only', () => {
    const backend = new PrometheusBackend('http://localhost:9090');
    expect(backend.kind).toBe('prometheus');
    expect(backend.capabilities()).toEqual({
      traces: 'unsupported',
      metrics: 'available',
      logs: 'unsupported',
    });
  });

  it('healthCheck returns version from /api/v1/status/buildinfo', async () => {
    stub = installFetchStub(() => ({
      body: { status: 'success', data: { version: '2.50.0' } },
    }));
    const health = await new PrometheusBackend(
      'http://localhost:9090',
    ).healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain('2.50.0');
  });

  it('listServices queries /api/v1/label/service_name/values', async () => {
    stub = installFetchStub(() => ({
      body: { status: 'success', data: ['api', 'web'] },
    }));
    const result = await new PrometheusBackend(
      'http://localhost:9090',
    ).listServices();
    expect(result.services).toEqual(['api', 'web']);
    expect(stub.calls[0]?.url).toContain('/api/v1/label/service_name/values');
  });

  it('listMetrics combines label/__name__/values and /api/v1/metadata', async () => {
    stub = installFetchStub((url) => {
      if (url.includes('/api/v1/label/__name__/values')) {
        return {
          body: {
            status: 'success',
            data: ['http_requests_total', 'up'],
          },
        };
      }
      return {
        body: {
          status: 'success',
          data: {
            http_requests_total: [
              { type: 'counter', help: 'Total HTTP requests', unit: '' },
            ],
          },
        },
      };
    });
    const backend = new PrometheusBackend('http://localhost:9090');
    const result = await backend.listMetrics();
    expect(result.items.map((m) => m.metricName)).toEqual([
      'http_requests_total',
      'up',
    ]);
    expect(result.items[0]?.attributes?.help).toBe('Total HTTP requests');
  });

  it('getMetricSeries builds a PromQL selector with service filter and range window', async () => {
    stub = installFetchStub(() => ({
      body: {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { __name__: 'http_requests_total', method: 'GET' },
              values: [
                [1700000000, '1'],
                [1700000060, '2'],
              ],
            },
          ],
        },
      },
    }));

    const backend = new PrometheusBackend('http://localhost:9090');
    const series = await backend.getMetricSeries('http_requests_total', {
      serviceName: 'api',
      startTimeUnixMs: 1_700_000_000_000,
      endTimeUnixMs: 1_700_000_060_000,
    });

    expect(series).toHaveLength(1);
    expect(series[0]?.points).toHaveLength(2);
    expect(series[0]?.attributes?.method).toBe('GET');

    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/query_range');
    expect(url.searchParams.get('query')).toBe(
      'http_requests_total{service_name="api"}',
    );
    expect(url.searchParams.get('start')).toBe('1700000000');
    expect(url.searchParams.get('end')).toBe('1700000060');
  });

  it('searchTraces and searchLogs report unsupported', async () => {
    const backend = new PrometheusBackend('http://localhost:9090');
    expect((await backend.searchTraces({})).unsupported).toBe(true);
    expect((await backend.searchLogs({})).unsupported).toBe(true);
  });

  it('listMetrics propagates fetch errors so the runtime probe can gate the tool', async () => {
    // Simulate an unreachable Prometheus: every fetch rejects. listMetrics
    // must NOT swallow the authoritative __name__/values failure, otherwise
    // probeSignalAvailability will leave list_metrics registered against a
    // dead backend.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    try {
      const backend = new PrometheusBackend('http://127.0.0.1:1');
      await expect(backend.listMetrics()).rejects.toThrow(/ECONNREFUSED/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
