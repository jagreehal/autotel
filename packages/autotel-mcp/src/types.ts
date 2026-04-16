// Signal support
export type SignalSupport = 'available' | 'unsupported';

export type SpanStatusCode = 'OK' | 'ERROR' | 'UNSET';

export type TagValue = string | number | boolean;

// Filter system
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between'
  | 'exists'
  | 'not_exists';

export type FilterValueType = 'string' | 'number' | 'boolean';

export interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value?: TagValue | TagValue[];
  valueType?: FilterValueType;
}

// Span and trace records
export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startTimeUnixMs: number;
  durationMs: number;
  statusCode: SpanStatusCode;
  tags: Record<string, TagValue>;
  hasError: boolean;
}

export interface TraceRecord {
  traceId: string;
  spans: SpanRecord[];
}

// Search queries
export interface TraceSearchQuery {
  service?: string;
  operation?: string;
  tags?: Record<string, TagValue>;
  minDurationMs?: number;
  maxDurationMs?: number;
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
  limit?: number;
  statusCode?: SpanStatusCode;
  hasError?: boolean;
  filters?: QueryFilter[];
}

export interface SpanSearchQuery extends TraceSearchQuery {
  spanMinDurationMs?: number;
  spanMaxDurationMs?: number;
}

export interface MetricSearchQuery {
  metricName?: string;
  serviceName?: string;
  lookbackMinutes?: number;
  limit?: number;
}

export interface MetricSeriesQuery {
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
  serviceName?: string;
  limit?: number;
}

export interface LogSearchQuery {
  serviceName?: string;
  traceId?: string;
  spanId?: string;
  severityText?: string;
  text?: string;
  attributes?: Record<string, TagValue>;
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
  limit?: number;
}

// Data structures
export interface MetricPoint {
  timestampUnixMs: number;
  value: number;
}

export interface MetricSeries {
  metricName: string;
  unit?: string;
  points: MetricPoint[];
  attributes?: Record<string, TagValue>;
}

export interface LogRecord {
  timestampUnixMs: number;
  severityText: string;
  body: string;
  serviceName?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, TagValue>;
}

// Search results (paginated)
export interface SearchResult<T> {
  items: T[];
  cursor?: string;
  totalCount: number;
  unsupported?: boolean;
  detail?: string;
}

export type TraceSearchResult = SearchResult<TraceRecord>;
export type SpanSearchResult = SearchResult<SpanRecord>;
export type MetricSearchResult = SearchResult<MetricSeries>;
export type LogSearchResult = SearchResult<LogRecord>;

// Backend health and capabilities
export interface BackendHealth {
  healthy: boolean;
  message?: string;
}

export interface BackendCapabilities {
  traces: SignalSupport;
  metrics: SignalSupport;
  logs: SignalSupport;
}

export interface ServiceListResult {
  services: string[];
}

export interface OperationListResult {
  operations: string[];
}

export interface ServiceQuery {
  limit?: number;
}

// Cross-signal correlation
export interface CorrelatedSignals {
  trace: TraceRecord | null;
  metrics: MetricSeries[];
  logs: LogRecord[];
}

// Service map
export interface ServiceMapNode {
  service: string;
  traces: number;
  spans: number;
  errors: number;
  inboundCalls: number;
  outboundCalls: number;
  avgDurationMs: number;
  errorRate: number;
}

export interface ServiceMapEdge {
  source: string;
  target: string;
  calls: number;
  errors: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface ServiceMap {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
}

// Trace summary
export interface TraceSummary {
  traceId: string;
  serviceName: string;
  durationMs: number;
  statusCode: SpanStatusCode;
  spanCount: number;
  llmSpanCount: number;
  errorSpanCount: number;
  totalTokens: number;
  modelsUsed: string[];
  serviceCount: number;
  topOperations: Array<{ operation: string; count: number }>;
}

// Instrumentation
export interface InstrumentationScore {
  score: number;
  grade: string;
  suggestions: string[];
}
