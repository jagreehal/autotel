import type {
  BackendCapabilities,
  BackendHealth,
  CorrelatedSignals,
  LogSearchQuery,
  LogSearchResult,
  MetricSearchQuery,
  MetricSearchResult,
  MetricSeries,
  MetricSeriesQuery,
  OperationListResult,
  ServiceListResult,
  ServiceMap,
  ServiceQuery,
  SignalSupport,
  SpanSearchQuery,
  SpanSearchResult,
  TraceRecord,
  TraceSearchQuery,
  TraceSearchResult,
  TraceSummary,
} from '../../types';
import type { TelemetryBackend } from '../telemetry';

export interface CompositeBackendParts {
  traces?: TelemetryBackend;
  metrics?: TelemetryBackend;
  logs?: TelemetryBackend;
}

/**
 * Delegates to per-signal backends. Each method routes to whichever
 * backend owns that signal. If no backend is wired for a signal, we
 * report `unsupported` cleanly.
 */
export class CompositeBackend implements TelemetryBackend {
  readonly kind = 'composite' as const;

  private readonly traces?: TelemetryBackend;
  private readonly metrics?: TelemetryBackend;
  private readonly logs?: TelemetryBackend;

  constructor(parts: CompositeBackendParts) {
    this.traces = parts.traces;
    this.metrics = parts.metrics;
    this.logs = parts.logs;
    if (!this.traces && !this.metrics && !this.logs) {
      throw new Error('CompositeBackend needs at least one signal backend.');
    }
  }

  async healthCheck(): Promise<BackendHealth> {
    const parts: Array<{ signal: string; health: BackendHealth }> = [];
    if (this.traces) {
      parts.push({ signal: 'traces', health: await this.traces.healthCheck() });
    }
    if (this.metrics) {
      parts.push({
        signal: 'metrics',
        health: await this.metrics.healthCheck(),
      });
    }
    if (this.logs) {
      parts.push({ signal: 'logs', health: await this.logs.healthCheck() });
    }
    const allHealthy = parts.every((p) => p.health.healthy);
    return {
      healthy: allHealthy,
      message: parts
        .map(
          (p) =>
            `${p.signal}(${p.health.healthy ? 'ok' : 'down'}): ${p.health.message ?? ''}`,
        )
        .join('; '),
    };
  }

  capabilities(): BackendCapabilities {
    const pick = (
      backend: TelemetryBackend | undefined,
      signal: 'traces' | 'metrics' | 'logs',
    ): SignalSupport =>
      backend?.capabilities()[signal] === 'available'
        ? 'available'
        : 'unsupported';
    return {
      traces: pick(this.traces, 'traces'),
      metrics: pick(this.metrics, 'metrics'),
      logs: pick(this.logs, 'logs'),
    };
  }

  async listServices(query?: ServiceQuery): Promise<ServiceListResult> {
    const results = await Promise.all(
      this.uniqueBackends().map((b) => b.listServices(query).catch(() => null)),
    );
    const set = new Set<string>();
    for (const res of results) {
      for (const s of res?.services ?? []) set.add(s);
    }
    return { services: [...set].sort() };
  }

  async listOperations(service: string): Promise<OperationListResult> {
    if (this.traces) return this.traces.listOperations(service);
    return { operations: [] };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    if (this.traces) return this.traces.searchTraces(query);
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: 'No traces backend is configured in this composite.',
    };
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    if (this.traces) return this.traces.searchSpans(query);
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: 'No traces backend is configured in this composite.',
    };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    if (this.traces) return this.traces.getTrace(traceId);
    return null;
  }

  async serviceMap(
    lookbackMinutes?: number,
    limit?: number,
  ): Promise<ServiceMap> {
    if (this.traces) return this.traces.serviceMap(lookbackMinutes, limit);
    return { nodes: [], edges: [] };
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    if (this.traces) return this.traces.summarizeTrace(traceId);
    return null;
  }

  async listMetrics(query?: MetricSearchQuery): Promise<MetricSearchResult> {
    if (this.metrics) return this.metrics.listMetrics(query);
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: 'No metrics backend is configured in this composite.',
    };
  }

  async getMetricSeries(
    name: string,
    query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    if (this.metrics) return this.metrics.getMetricSeries(name, query);
    return [];
  }

  async searchLogs(query?: LogSearchQuery): Promise<LogSearchResult> {
    if (this.logs) return this.logs.searchLogs(query);
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: 'No logs backend is configured in this composite.',
    };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const [trace, logsRes] = await Promise.all([
      this.traces ? this.traces.getTrace(traceId) : Promise.resolve(null),
      this.logs
        ? this.logs.searchLogs({ traceId, limit: 100 })
        : Promise.resolve({ items: [], totalCount: 0 }),
    ]);

    // Gather metrics for each service touched by the trace (if we have both).
    let metrics: MetricSeries[] = [];
    if (this.metrics && trace) {
      const services = new Set<string>();
      for (const span of trace.spans) services.add(span.serviceName);
      const perService = await Promise.all(
        [...services].map((service) =>
          this.metrics!.listMetrics({ serviceName: service, limit: 20 }).catch(
            () => ({ items: [] as MetricSeries[], totalCount: 0 }),
          ),
        ),
      );
      metrics = perService.flatMap((r) => r.items);
    }

    return { trace, metrics, logs: logsRes.items };
  }

  private uniqueBackends(): TelemetryBackend[] {
    const set = new Set<TelemetryBackend>();
    if (this.traces) set.add(this.traces);
    if (this.metrics) set.add(this.metrics);
    if (this.logs) set.add(this.logs);
    return [...set];
  }
}
