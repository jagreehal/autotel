import { jsonGet } from '../../lib/http';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../../modules/query-filters';
import { buildServiceMap } from '../../modules/service-map';
import { summarizeTrace } from '../../modules/trace-summary';
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
  TagValue,
  TraceRecord,
  TraceSearchQuery,
  TraceSearchResult,
  TraceSummary,
} from '../../types';
import { inferErrorStatusFromTags, normalizeTags } from '../span-mapping';
import type { TelemetryBackend } from '../telemetry';

/**
 * Shape returned by autotel-devtools' `GET /v1/traces` read-back endpoint.
 * Mirrors `SpanData`/`TraceData` in autotel-devtools/src/server/types.ts.
 *
 * Unlike Jaeger, devtools already pre-assembles spans into traces and reports
 * timestamps/durations in **milliseconds** (with sub-ms fractional precision),
 * so the mapping is direct — no microsecond conversion, no process table.
 */
interface DevtoolsSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTime: number;
  endTime: number;
  duration: number;
  attributes?: Record<string, unknown>;
  status?: { code: 'OK' | 'ERROR' | 'UNSET'; message?: string };
  scope?: { name?: string; version?: string };
}

interface DevtoolsTrace {
  traceId: string;
  rootSpan?: DevtoolsSpan;
  spans: DevtoolsSpan[];
  service: string;
  status?: 'OK' | 'ERROR' | 'UNSET';
  startTime: number;
  endTime: number;
  duration: number;
}

interface DevtoolsTracesResponse {
  traces: DevtoolsTrace[];
  count: number;
}

interface DevtoolsHealthResponse {
  ok?: boolean;
  service?: string;
  version?: string;
  clients?: number;
}

/**
 * Reads telemetry from a running `autotel-devtools` receiver via its HTTP
 * read-back API (`GET /v1/traces`). devtools is an OTLP sink with a web UI; it
 * streams logs/metrics to that UI over WebSocket but only exposes **traces**
 * over HTTP, so this backend reports metrics/logs as unsupported (same posture
 * as the Jaeger backend).
 *
 * Because devtools holds everything in memory there is no server-side query
 * language: we fetch the full trace set and apply autotel-mcp's shared
 * filters (`traceMatchesQuery`/`spanMatchesQuery`) client-side, exactly like
 * the Jaeger backend does for inferred errors.
 */
export class DevtoolsBackend implements TelemetryBackend {
  readonly kind = 'devtools' as const;

  constructor(private readonly baseUrl: string) {}

  private async fetchTraces(): Promise<DevtoolsTrace[]> {
    const data = await jsonGet<DevtoolsTracesResponse>(
      `${this.baseUrl}/v1/traces`,
    );
    return data.traces ?? [];
  }

  async healthCheck(): Promise<BackendHealth> {
    try {
      // /healthz is the canonical identity probe — it confirms we are talking
      // to autotel-devtools and not some other collector squatting on the port.
      const health = await jsonGet<DevtoolsHealthResponse>(
        `${this.baseUrl}/healthz`,
      );
      if (health.service && health.service !== 'autotel-devtools') {
        return {
          healthy: false,
          message: `${this.baseUrl} is held by "${health.service}", not autotel-devtools`,
        };
      }
      const traces = await this.fetchTraces();
      const version = health.version ? ` v${health.version}` : '';
      return {
        healthy: true,
        message: `autotel-devtools${version} reachable — ${traces.length} trace(s) captured`,
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
    const traces = await this.fetchTraces();
    const services = new Set<string>();
    for (const trace of traces) {
      for (const span of trace.spans) {
        services.add(serviceOf(span, trace));
      }
    }
    return { services: Array.from(services).sort() };
  }

  async listOperations(serviceName: string): Promise<OperationListResult> {
    const traces = await this.fetchTraces();
    const operations = new Set<string>();
    for (const trace of traces) {
      for (const span of trace.spans) {
        if (serviceOf(span, trace) === serviceName) {
          operations.add(span.name);
        }
      }
    }
    return { operations: Array.from(operations).sort() };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const records = (await this.fetchTraces()).map((trace) =>
      this.toTraceRecord(trace),
    );
    // traceMatchesQuery covers service/operation/error/status/duration/tags;
    // the time window is the one bound it does not apply (Jaeger pushes it
    // server-side — devtools holds everything in memory, so we filter here).
    const filtered = records.filter(
      (trace) =>
        withinTimeWindow(trace, query) && traceMatchesQuery(trace, query),
    );
    const items = filtered.slice(0, query.limit ?? 20);
    return { items, totalCount: filtered.length };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const traces = await this.fetchTraces();
    const trace = traces.find((candidate) => candidate.traceId === traceId);
    return trace ? this.toTraceRecord(trace) : null;
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    const traceResult = await this.searchTraces(query);
    const spans = traceResult.items.flatMap((trace) => trace.spans);
    // Strip filters — trace-level aggregates were already applied by searchTraces.
    const spanQuery = query.filters ? { ...query, filters: undefined } : query;
    const filtered = spans.filter((span) => spanMatchesQuery(span, spanQuery));
    const items = filtered.slice(0, query.limit ?? 50);
    return { items, totalCount: filtered.length };
  }

  async serviceMap(_lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const records = (await this.fetchTraces()).map((trace) =>
      this.toTraceRecord(trace),
    );
    return buildServiceMap(records, limit) as unknown as ServiceMap;
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
      detail:
        'autotel-devtools exposes traces only over HTTP — metrics stream to the UI over WebSocket',
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
      detail:
        'autotel-devtools exposes traces only over HTTP — logs stream to the UI over WebSocket',
    };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);
    return { trace, metrics: [], logs: [] };
  }

  toTraceRecord(trace: DevtoolsTrace): TraceRecord {
    const spans: SpanRecord[] = trace.spans.map((span) => {
      const tags = normalizeTags(span.attributes);
      const statusCode = resolveStatus(span.status?.code, tags);
      return {
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId ?? null,
        operationName: span.name,
        serviceName: serviceOf(span, trace),
        startTimeUnixMs: span.startTime,
        durationMs: span.duration,
        statusCode,
        tags,
        hasError: statusCode === 'ERROR',
      } satisfies SpanRecord;
    });

    return { traceId: trace.traceId, spans };
  }
}

function serviceOf(span: DevtoolsSpan, trace: DevtoolsTrace): string {
  const fromAttribute = span.attributes?.['service.name'];
  if (typeof fromAttribute === 'string' && fromAttribute.length > 0) {
    return fromAttribute;
  }
  return trace.service || 'unknown';
}

/**
 * devtools reports a structured OTel status. Trust it when it is OK/ERROR;
 * otherwise fall back to the shared tag-based error inference so error
 * filtering behaves consistently across backends.
 */
function resolveStatus(
  code: 'OK' | 'ERROR' | 'UNSET' | undefined,
  tags: Record<string, TagValue>,
): SpanStatusCode {
  if (code === 'ERROR' || code === 'OK') {
    return code;
  }
  return inferErrorStatusFromTags(tags);
}

/** True when the trace overlaps the query's time window (no window ⇒ always). */
function withinTimeWindow(
  trace: TraceRecord,
  query: TraceSearchQuery,
): boolean {
  if (
    query.startTimeUnixMs === undefined &&
    query.endTimeUnixMs === undefined
  ) {
    return true;
  }
  const startMs = query.startTimeUnixMs ?? 0;
  const endMs = query.endTimeUnixMs ?? Number.POSITIVE_INFINITY;
  return trace.spans.some(
    (span) => span.startTimeUnixMs >= startMs && span.startTimeUnixMs <= endMs,
  );
}
