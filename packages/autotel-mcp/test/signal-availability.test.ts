import { describe, expect, it } from 'vitest';
import { probeSignalAvailability } from '../src/modules/signal-availability';
import type { TelemetryBackend } from '../src/backends/telemetry';
import type { BackendCapabilities } from '../src/types';

const ALL_AVAILABLE: BackendCapabilities = {
  traces: 'available',
  metrics: 'available',
  logs: 'available',
};

/**
 * Minimal backend stub. Each signal method is overridable so a test can make
 * it resolve with data, resolve empty, report `unsupported`, or throw.
 */
function makeBackend(
  caps: BackendCapabilities,
  overrides: Partial<TelemetryBackend> = {},
): TelemetryBackend {
  return {
    kind: 'stub',
    capabilities: () => caps,
    healthCheck: async () => ({ healthy: true }),
    listServices: async () => ({ services: [] }),
    listOperations: async () => ({ operations: [] }),
    searchTraces: async () => ({ items: [], totalCount: 0 }),
    searchSpans: async () => ({ items: [], totalCount: 0 }),
    getTrace: async () => null,
    serviceMap: async () => ({ nodes: [], edges: [] }) as never,
    summarizeTrace: async () => null,
    listMetrics: async () => ({ items: [], totalCount: 0 }),
    getMetricSeries: async () => [],
    searchLogs: async () => ({ items: [], totalCount: 0 }),
    getCorrelatedSignals: async () => ({ trace: null, metrics: [], logs: [] }),
    ...overrides,
  } as TelemetryBackend;
}

describe('probeSignalAvailability', () => {
  it('marks a signal unsupported when capabilities say so', async () => {
    const backend = makeBackend({
      traces: 'unsupported',
      metrics: 'unsupported',
      logs: 'unsupported',
    });
    const result = await probeSignalAvailability(backend);
    expect(result.traces.enabled).toBe(false);
    expect(result.metrics.enabled).toBe(false);
    expect(result.logs.enabled).toBe(false);
  });

  it('enables a signal with data (hasData true)', async () => {
    const backend = makeBackend(ALL_AVAILABLE, {
      searchTraces: async () => ({
        items: [{ traceId: 't', spans: [] }],
        totalCount: 1,
      }),
    });
    const result = await probeSignalAvailability(backend);
    expect(result.traces.enabled).toBe(true);
    expect(result.traces.hasData).toBe(true);
  });

  it('keeps a reachable-but-empty signal enabled (hasData false)', async () => {
    const backend = makeBackend(ALL_AVAILABLE); // all queries resolve empty
    const result = await probeSignalAvailability(backend);
    expect(result.traces.enabled).toBe(true);
    expect(result.traces.hasData).toBe(false);
  });

  it('disables a signal only when the backend explicitly reports unsupported', async () => {
    const backend = makeBackend(ALL_AVAILABLE, {
      searchTraces: async () => ({
        items: [],
        totalCount: 0,
        unsupported: true,
        detail: 'no trace API',
      }),
    });
    const result = await probeSignalAvailability(backend);
    expect(result.traces.enabled).toBe(false);
  });

  it('keeps a signal enabled when the probe throws (transient/unreachable backend)', async () => {
    // Regression: a momentarily-down HTTP backend (Jaeger/Tempo/devtools) at
    // connect time must NOT disable trace tools for the whole session.
    const backend = makeBackend(ALL_AVAILABLE, {
      searchTraces: async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      },
      listMetrics: async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      },
      searchLogs: async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      },
    });
    const result = await probeSignalAvailability(backend);

    expect(result.traces.enabled).toBe(true);
    expect(result.traces.hasData).toBe(false);
    expect(result.traces.detail).toMatch(/retry on demand/i);
    expect(result.metrics.enabled).toBe(true);
    expect(result.logs.enabled).toBe(true);
  });
});
