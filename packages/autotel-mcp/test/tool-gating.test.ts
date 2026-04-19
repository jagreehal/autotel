import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools/index';
import type { TelemetryBackend } from '../src/backends/telemetry';
import { pickErrorMessage } from '../src/tools/diagnosis';
import type {
  BackendCapabilities,
  BackendHealth,
  LogSearchQuery,
  MetricSearchQuery,
  TraceSearchQuery,
} from '../src/types';

function stubBackend(caps: BackendCapabilities): TelemetryBackend {
  return {
    kind: 'stub',
    healthCheck: async (): Promise<BackendHealth> => ({
      healthy: true,
      message: 'ok',
    }),
    capabilities: () => caps,
    listServices: async () => ({ services: [] }),
    listOperations: async () => ({ operations: [] }),
    searchTraces: async (_q: TraceSearchQuery) => ({
      items: [],
      totalCount: 0,
    }),
    searchSpans: async () => ({ items: [], totalCount: 0 }),
    getTrace: async () => null,
    serviceMap: async () => ({ nodes: [], edges: [] }),
    summarizeTrace: async () => null,
    listMetrics: async (_q?: MetricSearchQuery) => ({
      items: [],
      totalCount: 0,
    }),
    getMetricSeries: async () => [],
    searchLogs: async (_q?: LogSearchQuery) => ({
      items: [],
      totalCount: 0,
    }),
    getCorrelatedSignals: async () => ({
      trace: null,
      metrics: [],
      logs: [],
    }),
  } satisfies TelemetryBackend;
}

function collectRegisteredTools(backend: TelemetryBackend): Set<string> {
  const server = new McpServer({ name: 't', version: '0.0.0' });
  const registered = new Set<string>();
  const original = server.registerTool.bind(server);
  server.registerTool = ((name: string, ...rest: unknown[]) => {
    registered.add(name);
    // Forward to preserve any side effects while capturing the name.
    return (original as (..._args: unknown[]) => unknown)(name, ...rest);
  }) as typeof server.registerTool;
  registerTools(server, backend);
  return registered;
}

describe('capability-aware tool registration', () => {
  it('hides trace tools when backend has no traces', () => {
    const names = collectRegisteredTools(
      stubBackend({
        traces: 'unsupported',
        metrics: 'available',
        logs: 'unsupported',
      }),
    );
    expect(names.has('search_traces')).toBe(false);
    expect(names.has('search_spans')).toBe(false);
    expect(names.has('find_errors')).toBe(false);
    expect(names.has('service_map')).toBe(false);
    expect(names.has('correlate')).toBe(false);
    expect(names.has('discover_trace_fields')).toBe(false);
    expect(names.has('discover_log_fields')).toBe(false);
    expect(names.has('discover_services')).toBe(true);
    expect(names.has('list_metrics')).toBe(true);
    expect(names.has('search_logs')).toBe(false);
  });

  it('hides log tool when backend has no logs', () => {
    const names = collectRegisteredTools(
      stubBackend({
        traces: 'available',
        metrics: 'available',
        logs: 'unsupported',
      }),
    );
    expect(names.has('search_logs')).toBe(false);
    expect(names.has('list_metrics')).toBe(true);
    expect(names.has('search_traces')).toBe(true);
    expect(names.has('discover_trace_fields')).toBe(true);
    expect(names.has('discover_log_fields')).toBe(false);
    expect(names.has('discover_services')).toBe(true);
  });

  it('registers the full trace toolset when everything is available', () => {
    const names = collectRegisteredTools(
      stubBackend({
        traces: 'available',
        metrics: 'available',
        logs: 'available',
      }),
    );
    for (const name of [
      'search_traces',
      'search_spans',
      'get_trace',
      'summarize_trace',
      'service_map',
      'find_errors',
      'find_anomalies',
      'find_root_cause',
      'check_slos',
      'correlate',
      'explain_slowdown',
      'list_metrics',
      'search_logs',
      'discover_trace_fields',
      'discover_log_fields',
      'discover_services',
    ]) {
      expect(names.has(name), `expected ${name} registered`).toBe(true);
    }
  });

  it('health tools and collector-config tools always register', () => {
    const names = collectRegisteredTools(
      stubBackend({
        traces: 'unsupported',
        metrics: 'unsupported',
        logs: 'unsupported',
      }),
    );
    expect(names.has('backend_health')).toBe(true);
    expect(names.has('validate_collector_config')).toBe(true);
  });
});

describe('pickErrorMessage precedence', () => {
  it('prefers exception.message above all other keys', () => {
    expect(
      pickErrorMessage({
        'exception.message': 'explicit exception',
        'error.message': 'generic error',
        'validation.error': 'bad IBAN',
      }),
    ).toBe('explicit exception');
  });

  it('falls back through error.message and validation.error', () => {
    expect(
      pickErrorMessage({
        'validation.error': 'Invalid IBAN format',
        'otel.status_description': 'An error has occurred',
      }),
    ).toBe('Invalid IBAN format');
  });

  it('uses otel.status_description when nothing else is present', () => {
    expect(
      pickErrorMessage({
        'otel.status_description': 'An error has occurred',
      }),
    ).toBe('An error has occurred');
  });

  it('returns undefined when no recognised key carries a string', () => {
    expect(pickErrorMessage({})).toBeUndefined();
    expect(pickErrorMessage({ 'error.message': 42 })).toBeUndefined();
  });
});
