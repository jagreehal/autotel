import { describe, expect, it } from 'vitest';
import { FixtureBackend } from '../src/backends/fixture/index.js';

const FIXTURE_PATH = new URL('../fixtures/telemetry.json', import.meta.url)
  .pathname;

describe('FixtureBackend', () => {
  it('loads traces, metrics, and logs from the fixture file', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);

    const health = await backend.healthCheck();
    expect(health.healthy).toBe(true);

    const capabilities = backend.capabilities();
    expect(capabilities.metrics).toBe('available');
    expect(capabilities.logs).toBe('available');

    const traces = await backend.searchTraces({
      statusCode: 'ERROR',
      limit: 5,
    });
    expect(traces.items.length).toBeGreaterThan(0);

    const allTraces = await backend.searchTraces({});
    expect(allTraces.totalCount).toBeGreaterThan(0);

    const metrics = await backend.listMetrics({ serviceName: 'checkout' });
    expect(metrics.items).toHaveLength(1);
    expect(metrics.totalCount).toBe(1);

    const logs = await backend.searchLogs({ traceId: 'fixture-trace-1' });
    expect(logs.items).toHaveLength(1);
    expect(logs.totalCount).toBe(1);
  });

  it('getTrace returns the correct trace by id', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const trace = await backend.getTrace('fixture-trace-1');
    expect(trace).not.toBeNull();
    expect(trace!.traceId).toBe('fixture-trace-1');
  });

  it('getTrace returns null for unknown id', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const trace = await backend.getTrace('nonexistent');
    expect(trace).toBeNull();
  });

  it('listServices returns services from trace spans', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const result = await backend.listServices();
    expect(result.services).toContain('checkout');
    expect(result.services).toContain('payments');
  });

  it('serviceMap respects the requested limit', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const map = await backend.serviceMap(60, 1);
    expect(map.nodes.length).toBeLessThanOrEqual(1);
  });

  it('searchSpans supports aggregate trace filters', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const result = await backend.searchSpans({
      service: 'checkout',
      filters: [
        {
          field: 'span_count',
          operator: 'equals',
          valueType: 'number',
          value: 2,
        },
      ],
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  it('searchSpans returns flattened span records', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const result = await backend.searchSpans({ statusCode: 'ERROR' });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.totalCount).toBeGreaterThan(0);
  });

  it('getMetricSeries returns points for known metric', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const series = await backend.getMetricSeries('http.server.duration');
    expect(series.length).toBeGreaterThan(0);
    expect(series[0]!.points.length).toBeGreaterThan(0);
  });

  it('getMetricSeries returns empty for unknown metric', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const series = await backend.getMetricSeries('unknown.metric');
    expect(series).toHaveLength(0);
  });

  it('getCorrelatedSignals returns trace + metrics + logs', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const result = await backend.getCorrelatedSignals('fixture-trace-1');
    expect(result.trace).not.toBeNull();
    expect(result.trace!.traceId).toBe('fixture-trace-1');
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it('getCorrelatedSignals returns null trace for unknown ID', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const result = await backend.getCorrelatedSignals('nonexistent');
    expect(result.trace).toBeNull();
  });

  it('summarizeTrace returns a summary for a known trace', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const summary = await backend.summarizeTrace('fixture-trace-1');
    expect(summary).not.toBeNull();
    expect(summary!.traceId).toBe('fixture-trace-1');
    expect(summary!.spanCount).toBe(2);
  });

  it('summarizeTrace returns null for unknown trace', async () => {
    const backend = new FixtureBackend(FIXTURE_PATH);
    const summary = await backend.summarizeTrace('nonexistent');
    expect(summary).toBeNull();
  });
});
