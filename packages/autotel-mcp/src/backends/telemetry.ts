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
} from '../types';
import type { Issue } from 'autotel-devtools/issues';

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

  /**
   * Stored issues, with status, for backends that keep issue state (devtools).
   * `undefined` means "not supported here": callers group issues themselves.
   */
  listIssues?(query: IssueListQuery): Promise<Issue[] | undefined>;

  /**
   * Coding-agent token and cost usage (devtools, from Claude Code / Codex /
   * opencode telemetry). `undefined` means this backend does not keep it.
   */
  agentUsage?(query: AgentUsageQuery): Promise<object | undefined>;

  /**
   * Received telemetry checked against upstream semantic conventions (devtools,
   * through `weaver`). `run` starts a fresh check; otherwise the latest result.
   * `undefined` means this backend does not validate.
   */
  semconvValidation?(run: boolean): Promise<object | undefined>;
}

export interface AgentUsageQuery {
  session?: string;
  prompt?: string;
  repository?: string;
  agent?: string;
  latest?: 'session' | 'prompt';
}

export interface IssueListQuery {
  service?: string;
  start: number;
  end: number;
  quietMs: number;
}
