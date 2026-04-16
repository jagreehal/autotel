import { jsonGet } from '../../lib/http.js';
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
  ServiceQuery,
  SpanRecord,
  SpanSearchQuery,
  SpanSearchResult,
  SpanStatusCode,
  TraceRecord,
  TraceSearchQuery,
  TraceSearchResult,
} from '../../types.js';
import type { TelemetryBackend } from '../telemetry.js';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../../modules/query-filters.js';
import { buildServiceMap } from '../../modules/service-map.js';
import { summarizeTrace } from '../../modules/trace-summary.js';
import type { ServiceMap, TraceSummary } from '../../types.js';

type JaegerServiceResponse = { data: string[] };
type JaegerTraceData = {
  traceID: string;
  spans: Array<{
    traceID: string;
    spanID: string;
    parentSpanID?: string;
    operationName: string;
    processID?: string;
    startTime: number;
    duration: number;
    tags?: Array<{ key: string; type: string; value: unknown }>;
  }>;
  processes?: Record<string, { serviceName: string }>;
};
type JaegerTraceSearchResponse = { data: JaegerTraceData[] };
type JaegerTraceResponse = { data: JaegerTraceData[] };

export class JaegerBackend implements TelemetryBackend {
  readonly kind = 'jaeger' as const;

  constructor(private readonly baseUrl: string) {}

  async healthCheck(): Promise<BackendHealth> {
    try {
      const services = await this.listServices();
      return {
        healthy: true,
        message: `${services.services.length} services available`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  capabilities(): BackendCapabilities {
    return {
      traces: 'available',
      metrics: 'unsupported',
      logs: 'unsupported',
    };
  }

  async listServices(_query?: ServiceQuery): Promise<ServiceListResult> {
    const data = await jsonGet<JaegerServiceResponse>(
      `${this.baseUrl}/api/services`,
    );
    return { services: data.data ?? [] };
  }

  async listOperations(serviceName: string): Promise<OperationListResult> {
    const data = await jsonGet<JaegerServiceResponse>(
      `${this.baseUrl}/api/services/${encodeURIComponent(serviceName)}/operations`,
    );
    return { operations: data.data ?? [] };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const service = query.service;

    if (!service) {
      const services = await this.listServices();
      const results = await Promise.all(
        services.services.map((svc) =>
          this.searchTraces({
            ...query,
            service: svc,
            limit: query.limit ?? 20,
          }),
        ),
      );
      const deduped = new Map<string, TraceRecord>();
      for (const result of results) {
        for (const trace of result.items) {
          deduped.set(trace.traceId, trace);
        }
      }
      const items = Array.from(deduped.values())
        .filter((trace) => traceMatchesQuery(trace, query))
        .slice(0, query.limit ?? 20);
      return { items, totalCount: items.length };
    }

    const params = new URLSearchParams();
    params.set('lookback', `${60}m`);
    params.set('limit', `${query.limit ?? 20}`);
    params.set('service', service);
    if (query.operation) params.set('operation', query.operation);
    if (query.hasError) params.set('tags', 'error=true');

    const data = await jsonGet<JaegerTraceSearchResponse>(
      `${this.baseUrl}/api/traces?${params}`,
    );
    const items = data.data
      .map((trace) => this.toTraceRecord(trace))
      .filter((trace) => traceMatchesQuery(trace, query));
    return { items, totalCount: items.length };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const data = await jsonGet<JaegerTraceResponse>(
      `${this.baseUrl}/api/traces/${encodeURIComponent(traceId)}`,
    );
    const trace = data.data[0];
    return trace ? this.toTraceRecord(trace) : null;
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    const traceResult = await this.searchTraces(query);
    const spans = traceResult.items.flatMap((trace) => trace.spans);
    // Strip filters — trace-level aggregates were already applied by searchTraces
    const spanQuery = query.filters ? { ...query, filters: undefined } : query;
    const filtered = spans.filter((span) => spanMatchesQuery(span, spanQuery));
    const items = filtered.slice(0, query.limit ?? 50);
    return { items, totalCount: items.length };
  }

  async serviceMap(_lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const result = await this.searchTraces({ limit, service: undefined });
    return buildServiceMap(result.items, limit) as unknown as ServiceMap;
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    const trace = await this.getTrace(traceId);
    if (!trace) return null;
    return summarizeTrace(trace) as unknown as TraceSummary;
  }

  async listMetrics(_query?: MetricSearchQuery): Promise<MetricSearchResult> {
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: 'Jaeger does not expose metrics',
    };
  }

  async getMetricSeries(
    _name: string,
    _query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    return [];
  }

  async searchLogs(_query?: LogSearchQuery): Promise<LogSearchResult> {
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: 'Jaeger does not expose logs',
    };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);
    return {
      trace,
      metrics: [],
      logs: [],
    };
  }

  toTraceRecord(trace: JaegerTraceData): TraceRecord {
    const processEntries = trace.processes ?? {};
    const spans: SpanRecord[] = trace.spans.map((span) => {
      const serviceName = span.processID
        ? (processEntries[span.processID]?.serviceName ?? 'unknown')
        : 'unknown';
      const tags = Object.fromEntries(
        (span.tags ?? []).map((tag) => [tag.key, normalizeTagValue(tag.value)]),
      );
      return {
        traceId: span.traceID,
        spanId: span.spanID,
        parentSpanId: span.parentSpanID ?? null,
        operationName: span.operationName,
        serviceName,
        startTimeUnixMs: Math.floor(span.startTime / 1000),
        durationMs: Math.floor(span.duration / 1000),
        tags,
        hasError:
          tags['error'] === true ||
          tags['error.kind'] !== undefined ||
          inferStatusCode(tags) === 'ERROR',
        statusCode: inferStatusCode(tags),
      } satisfies SpanRecord;
    });

    return {
      traceId: trace.traceID,
      spans,
    };
  }
}

function normalizeTagValue(value: unknown): string | number | boolean {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
}

function inferStatusCode(
  tags: Record<string, string | number | boolean>,
): SpanStatusCode {
  const statusTag = tags['status.code'];
  if (typeof statusTag === 'string') {
    const normalized = statusTag.toUpperCase();
    if (
      normalized === 'ERROR' ||
      normalized === 'OK' ||
      normalized === 'UNSET'
    ) {
      return normalized as SpanStatusCode;
    }
  }

  if (tags['error'] === true || tags['error.kind'] !== undefined) {
    return 'ERROR';
  }

  const httpStatus = readNumericTag(tags['http.status_code']);
  if (httpStatus !== undefined) {
    if (httpStatus >= 500) return 'ERROR';
    if (httpStatus >= 100) return 'OK';
  }

  const grpcStatus = readNumericTag(tags['rpc.grpc.status_code']);
  if (grpcStatus !== undefined) {
    return grpcStatus === 0 ? 'OK' : 'ERROR';
  }

  return 'UNSET';
}

function readNumericTag(
  value: string | number | boolean | undefined,
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
