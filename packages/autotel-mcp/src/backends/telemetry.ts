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
} from '../types.js';

export interface TelemetryBackend {
  readonly kind: string;

  healthCheck(): Promise<BackendHealth>;
  capabilities(): BackendCapabilities;

  listServices(query?: ServiceQuery): Promise<ServiceListResult>;
  listOperations(service: string): Promise<OperationListResult>;
  searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult>;
  searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult>;
  getTrace(traceId: string): Promise<TraceRecord | null>;
  serviceMap(lookbackMinutes?: number, limit?: number): Promise<ServiceMap>;
  summarizeTrace(traceId: string): Promise<TraceSummary | null>;

  listMetrics(query?: MetricSearchQuery): Promise<MetricSearchResult>;
  getMetricSeries(
    name: string,
    query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]>;

  searchLogs(query?: LogSearchQuery): Promise<LogSearchResult>;

  getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals>;
}
