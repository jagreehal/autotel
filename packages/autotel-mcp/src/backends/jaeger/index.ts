import { jsonGet } from '../../lib/http';
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
} from '../../types';
import type { TelemetryBackend } from '../telemetry';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../../modules/query-filters';
import { buildServiceMap } from '../../modules/service-map';
import { summarizeTrace } from '../../modules/trace-summary';
import type { ServiceMap, TraceSummary } from '../../types';

type JaegerServiceResponse = { data: string[] };
type JaegerSpanReference = {
  refType: 'CHILD_OF' | 'FOLLOWS_FROM' | string;
  traceID: string;
  spanID: string;
};
type JaegerTraceData = {
  traceID: string;
  spans: Array<{
    traceID: string;
    spanID: string;
    /**
     * Jaeger's native API does NOT populate this field. It exposes parent
     * relationships via `references` with `refType: 'CHILD_OF'`. Kept here
     * for backward-compat with the few clients that synthesize it; we only
     * use it as a last-resort fallback.
     */
    parentSpanID?: string;
    references?: JaegerSpanReference[];
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

    // Over-fetch when the query needs post-filtering (hasError), since
    // Jaeger's `tags` search can't match bool tags or inferred errors.
    // traceMatchesQuery below applies the full hasError inference.
    const clientLimit = query.limit ?? 20;
    const serverLimit = query.hasError
      ? Math.min(200, clientLimit * 10)
      : clientLimit;

    const params = new URLSearchParams();
    params.set('limit', `${serverLimit}`);
    params.set('service', service);
    if (query.operation) params.set('operation', query.operation);
    // Jaeger accepts `start` and `end` in microseconds, or a `lookback`
    // window. Prefer explicit time bounds when the caller provides them;
    // otherwise default to the last 60 minutes.
    if (
      query.startTimeUnixMs !== undefined ||
      query.endTimeUnixMs !== undefined
    ) {
      const endMs = query.endTimeUnixMs ?? Date.now();
      const startMs = query.startTimeUnixMs ?? endMs - 60 * 60 * 1000;
      params.set('start', `${Math.floor(startMs * 1000)}`);
      params.set('end', `${Math.floor(endMs * 1000)}`);
    } else {
      params.set('lookback', '60m');
    }
    if (query.minDurationMs !== undefined) {
      params.set('minDuration', `${query.minDurationMs}ms`);
    }
    if (query.maxDurationMs !== undefined) {
      params.set('maxDuration', `${query.maxDurationMs}ms`);
    }

    const data = await jsonGet<JaegerTraceSearchResponse>(
      `${this.baseUrl}/api/traces?${params}`,
    );
    const items = data.data
      .map((trace) => this.toTraceRecord(trace))
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, clientLimit);
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
    // Fan out per-service so every service contributes traces. Going through
    // searchTraces with service=undefined truncates the merged result to
    // `limit`, which can evict services that produced fewer traces than the
    // chatty ones (e.g. Jaeger's own /api/* spans).
    const services = await this.listServices();
    const perServiceLimit = Math.max(limit, 20);
    const results = await Promise.all(
      services.services.map((svc) =>
        this.searchTraces({ service: svc, limit: perServiceLimit }),
      ),
    );
    const deduped = new Map<string, TraceRecord>();
    for (const result of results) {
      for (const trace of result.items) {
        deduped.set(trace.traceId, trace);
      }
    }
    return buildServiceMap(
      Array.from(deduped.values()),
      limit,
    ) as unknown as ServiceMap;
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
      const childOfRef = span.references?.find(
        (ref) => ref.refType === 'CHILD_OF',
      );
      return {
        traceId: span.traceID,
        spanId: span.spanID,
        parentSpanId: childOfRef?.spanID ?? span.parentSpanID ?? null,
        operationName: span.operationName,
        serviceName,
        startTimeUnixMs: Math.floor(span.startTime / 1000),
        // Preserve sub-ms precision — Jaeger reports duration in microseconds.
        // Flooring rounds small spans to 0, which breaks median/MAD anomaly
        // detection and p95 edge calculations.
        durationMs: span.duration / 1000,
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
