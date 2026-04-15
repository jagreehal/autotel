import type { TelemetryBackend } from '../telemetry.js';
import { CollectorStore } from './store.js';
import { OtlpReceiver } from './receiver.js';
import type {
  BackendHealth,
  BackendCapabilities,
  ServiceListResult,
  OperationListResult,
  ServiceQuery,
  TraceSearchQuery,
  TraceSearchResult,
  SpanSearchQuery,
  SpanSearchResult,
  MetricSearchQuery,
  MetricSearchResult,
  MetricSeriesQuery,
  MetricSeries,
  LogSearchQuery,
  LogSearchResult,
  TraceRecord,
  CorrelatedSignals,
  ServiceMap,
  TraceSummary,
} from '../../types.js';

// Import module functions for service map and trace summary
// These modules use local types that may differ slightly from types.ts
// Use the modules' own return types and cast as needed
import { buildServiceMap } from '../../modules/service-map.js';
import { summarizeTrace as buildTraceSummary } from '../../modules/trace-summary.js';

export interface CollectorBackendOptions {
  port: number;
  maxTraces: number;
  retentionMs: number;
  persist?: string;
}

export class CollectorBackend implements TelemetryBackend {
  readonly kind = 'collector';
  private store: CollectorStore;
  private receiver: OtlpReceiver;

  constructor(opts: CollectorBackendOptions) {
    const url = opts.persist ? `file:${opts.persist}` : 'file::memory:';
    this.store = new CollectorStore({
      maxTraces: opts.maxTraces,
      retentionMs: opts.retentionMs,
      url,
    });
    this.receiver = new OtlpReceiver(this.store, opts.port);
  }

  async start(): Promise<void> {
    await this.store.init();
    await this.receiver.start();
  }

  async stop(): Promise<void> {
    await this.receiver.stop();
  }

  async healthCheck(): Promise<BackendHealth> {
    return { healthy: true, message: 'Collector running' };
  }

  capabilities(): BackendCapabilities {
    return { traces: 'available', metrics: 'available', logs: 'available' };
  }

  async listServices(_query?: ServiceQuery): Promise<ServiceListResult> {
    return this.store.listServices();
  }

  async listOperations(service: string): Promise<OperationListResult> {
    return this.store.listOperations(service);
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    return this.store.searchTraces(query);
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    return this.store.searchSpans(query);
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    return this.store.getTrace(traceId);
  }

  async serviceMap(
    lookbackMinutes?: number,
    limit?: number,
  ): Promise<ServiceMap> {
    const traces = await this.store.getAllTraces(lookbackMinutes);
    return buildServiceMap(traces, limit) as unknown as ServiceMap;
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    const trace = await this.store.getTrace(traceId);
    if (!trace) return null;
    return buildTraceSummary(trace) as unknown as TraceSummary;
  }

  async listMetrics(query?: MetricSearchQuery): Promise<MetricSearchResult> {
    return this.store.listMetrics(query ?? {});
  }

  async getMetricSeries(
    name: string,
    query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    return this.store.getMetricSeries(name, query);
  }

  async searchLogs(query?: LogSearchQuery): Promise<LogSearchResult> {
    return this.store.searchLogs(query ?? {});
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.store.getTrace(traceId);
    const services = trace
      ? [...new Set(trace.spans.map((s) => s.serviceName))]
      : [];

    const logs = await this.store.searchLogs({ traceId });
    const metrics: MetricSeries[] = [];

    for (const service of services) {
      const svcMetrics = await this.store.listMetrics({ serviceName: service });
      metrics.push(...svcMetrics.items);
    }

    return { trace, metrics, logs: logs.items };
  }
}
