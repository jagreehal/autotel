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
  ServiceMap,
  ServiceQuery,
  SpanRecord,
  SpanSearchQuery,
  SpanSearchResult,
  SpanStatusCode,
  TraceRecord,
  TraceSearchQuery,
  TraceSearchResult,
  TraceSummary,
} from '../../types';
import type { TelemetryBackend } from '../telemetry';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../../modules/query-filters';
import { buildServiceMap } from '../../modules/service-map';
import { summarizeTrace } from '../../modules/trace-summary';
import { normalizeTagValue } from '../span-mapping';

/**
 * SigNoz — trace-only backend over the ClickHouse-backed HTTP API.
 *
 *   GET /api/v1/services      list APM services
 *   GET /api/v1/traces/{id}   fetch one trace's spans
 *
 * Auth is the `SIGNOZ-API-KEY` header on SigNoz Cloud. Self-hosted instances
 * commonly run unauthenticated on a private network, so an absent key is a
 * supported configuration rather than an error.
 *
 * Timestamps are nanoseconds (`startTime`, `durationNano`) and status is the
 * numeric OTLP code rather than a string.
 */

const NS_PER_MS = 1_000_000;

/** Number of traces to sample per service when assembling a search or map. */
const SERVICE_SAMPLE_LIMIT = 20;

interface SignozService {
  serviceName?: string;
}

interface SignozSpan {
  traceID?: string;
  spanID?: string;
  parentSpanID?: string;
  name?: string;
  serviceName?: string;
  /** Nanoseconds since the epoch. */
  startTime?: number;
  durationNano?: number;
  /** OTLP numeric status: 0 unset, 1 ok, 2 error. */
  statusCode?: number;
  statusMessage?: string;
  attributes?: Record<string, unknown> | null;
}

export interface SignozBackendOptions {
  /** Base URL of the SigNoz instance. */
  baseUrl: string;
  /** Cloud API key. Empty for an unauthenticated self-hosted instance. */
  apiKey?: string;
}

/** OTLP numeric status → the string form the rest of the codebase uses. */
export function toStatusCode(status: number | undefined): SpanStatusCode {
  if (status === 2) return 'ERROR';
  if (status === 1) return 'OK';
  return 'UNSET';
}

export class SignozBackend implements TelemetryBackend {
  readonly kind = 'signoz' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: SignozBackendOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey ?? '';
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { 'SIGNOZ-API-KEY': this.apiKey } : {};
  }

  private get<T>(path: string): Promise<T> {
    return jsonGet<T>(new URL(path, this.baseUrl).toString(), {
      headers: this.headers(),
    });
  }

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
    const body = await this.get<{ data?: SignozService[] }>('/api/v1/services');
    return {
      services: (body.data ?? [])
        .map((service) => service.serviceName ?? '')
        .filter((name) => name.length > 0),
    };
  }

  async listOperations(serviceName: string): Promise<OperationListResult> {
    const traces = await this.searchTraces({
      service: serviceName,
      limit: SERVICE_SAMPLE_LIMIT,
    });
    const operations = new Set<string>();
    for (const trace of traces.items) {
      for (const span of trace.spans) {
        if (span.serviceName === serviceName)
          operations.add(span.operationName);
      }
    }
    return { operations: Array.from(operations) };
  }

  /**
   * SigNoz's trace listing lives behind its generic `query_range` builder,
   * whose payload shape moves between releases. Rather than pin to a shape that
   * silently breaks on upgrade, assemble results from the stable endpoints:
   * take the services list, pull recent traces per service, and filter here.
   *
   * ponytail: per-service fan-out, swap for query_range if it costs too much on a big install
   */
  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const limit = query.limit ?? 20;
    const services = query.service
      ? [query.service]
      : (await this.listServices()).services;

    const traceIdsBySvc = await Promise.all(
      services.map((service) => this.recentTraceIds(service)),
    );
    const traceIds = Array.from(new Set(traceIdsBySvc.flat())).slice(
      0,
      limit * 2,
    );

    const traces = await Promise.all(traceIds.map((id) => this.getTrace(id)));
    const items = traces
      .filter((trace): trace is TraceRecord => trace !== null)
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, limit);
    return { items, totalCount: items.length };
  }

  /** Recent trace ids for one service, via the top-operations sample endpoint. */
  private async recentTraceIds(service: string): Promise<string[]> {
    try {
      const body = await this.get<{ data?: Array<{ traceID?: string }> }>(
        `/api/v1/traces?service=${encodeURIComponent(service)}&limit=${SERVICE_SAMPLE_LIMIT}`,
      );
      return (body.data ?? [])
        .map((row) => row.traceID ?? '')
        .filter((id) => id.length > 0);
    } catch {
      // A SigNoz build without this listing shape shouldn't fail the whole
      // search — other services may still return results.
      return [];
    }
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const body = await this.get<{ data?: SignozSpan[] }>(
      `/api/v1/traces/${encodeURIComponent(traceId)}`,
    );
    const spans = (body.data ?? []).map((span) => toSpanRecord(span, traceId));
    if (spans.length === 0) return null;
    return { traceId, spans };
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    const traceResult = await this.searchTraces(query);
    const spans = traceResult.items.flatMap((trace) => trace.spans);
    const spanQuery = query.filters ? { ...query, filters: undefined } : query;
    const items = spans
      .filter((span) => spanMatchesQuery(span, spanQuery))
      .slice(0, query.limit ?? 50);
    return { items, totalCount: items.length };
  }

  async serviceMap(_lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const traces = await this.searchTraces({ limit: Math.max(limit, 20) });
    return buildServiceMap(traces.items, limit) as unknown as ServiceMap;
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
      detail: 'The SigNoz backend serves traces only',
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
      detail: 'The SigNoz backend serves traces only',
    };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);
    return { trace, metrics: [], logs: [] };
  }
}

function toSpanRecord(span: SignozSpan, fallbackTraceId: string): SpanRecord {
  const statusCode = toStatusCode(span.statusCode);
  return {
    traceId: span.traceID ?? fallbackTraceId,
    spanId: span.spanID ?? '',
    parentSpanId: span.parentSpanID ?? null,
    operationName: span.name ?? 'span',
    serviceName: span.serviceName ?? 'unknown',
    startTimeUnixMs: Math.floor((span.startTime ?? 0) / NS_PER_MS),
    durationMs: (span.durationNano ?? 0) / NS_PER_MS,
    tags: Object.fromEntries(
      Object.entries(span.attributes ?? {}).map(([key, value]) => [
        key,
        normalizeTagValue(value),
      ]),
    ),
    hasError: statusCode === 'ERROR',
    statusCode,
  };
}
