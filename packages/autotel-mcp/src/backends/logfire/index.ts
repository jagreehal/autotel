import { HttpError, jsonPost } from '../../lib/http';
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
 * Pydantic Logfire — trace-only backend over the `/v2/query` SQL API.
 *
 * Logfire stores spans in a ClickHouse-backed `records` table and returns
 * `gen_ai.*` semantic-convention attributes and W3C trace/span ids verbatim, so
 * the mapping below is mostly a rename rather than a reconstruction.
 *
 * Three behaviours here are load-bearing and were established against the live
 * API rather than the docs:
 *
 * - the endpoint is `/v2/query`, not `/v1/query`
 * - `min_timestamp` is effectively required; omitting it returns HTTP 422
 * - JSON replies are row-oriented `{schema, data:[rowdict]}`, and the response
 *   defaults to Arrow binary unless `Accept: application/json` is set
 *
 * Reads need a **read-scope** token; a write token is rejected.
 *
 * The read and write paths are asymmetric, which is easy to get wrong:
 * ingest accepts the token-routed host `logfire-api.pydantic.dev` and works out
 * the region from the token, but the query API does **not** — it 401s there and
 * needs the region host (`logfire-us` / `logfire-eu`) explicitly. Both failures
 * look like an identical bare 401, so `explainAuthFailure` names both causes.
 */

/** Columns the trace queries select, in one place so both queries stay in step. */
const SPAN_COLUMNS = [
  'trace_id',
  'span_id',
  'parent_span_id',
  'span_name',
  'start_timestamp',
  'end_timestamp',
  'service_name',
  'is_exception',
  'attributes',
].join(', ');

/** Fallback lookback when the caller gave no window, since a bound is mandatory. */
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** How many spans to pull per trace when expanding a search into full traces. */
const SPANS_PER_TRACE_ESTIMATE = 20;

interface LogfireSpanRow {
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  span_name: string;
  start_timestamp: string;
  end_timestamp: string;
  service_name?: string | null;
  is_exception?: boolean;
  attributes?: Record<string, unknown> | null;
}

interface LogfireQueryResponse<Row> {
  schema?: { fields?: Array<{ name: string; datatype?: string }> };
  data?: Row[];
}

export interface LogfireBackendOptions {
  /** Region base URL, e.g. `https://logfire-us.pydantic.dev`. */
  baseUrl: string;
  /** Read-scope API token. */
  readToken: string;
}

/** Single-quote escaping for SQL string literals. */
function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

export class LogfireBackend implements TelemetryBackend {
  readonly kind = 'logfire' as const;

  private readonly baseUrl: string;
  private readonly readToken: string;

  constructor(options: LogfireBackendOptions) {
    this.baseUrl = options.baseUrl;
    this.readToken = options.readToken;
  }

  private async query<Row>(
    sql: string,
    minTimestampMs?: number,
  ): Promise<Row[]> {
    if (!this.readToken) {
      throw new Error(
        'Logfire read token missing. Set LOGFIRE_READ_TOKEN to a read-scope token (a write token is rejected).',
      );
    }
    try {
      const body = await jsonPost<LogfireQueryResponse<Row>>(
        new URL('/v2/query', this.baseUrl).toString(),
        {
          sql,
          min_timestamp: new Date(
            minTimestampMs ?? Date.now() - DEFAULT_LOOKBACK_MS,
          ).toISOString(),
        },
        { Authorization: `Bearer ${this.readToken}` },
      );
      return body.data ?? [];
    } catch (error) {
      throw this.explainAuthFailure(error);
    }
  }

  /**
   * A token for the wrong data region and a write token used for reads both
   * come back as an indistinguishable 401. Name both causes so the reader
   * doesn't have to bisect them.
   */
  private explainAuthFailure(error: unknown): unknown {
    if (!(error instanceof HttpError)) return error;
    if (error.status !== 401 && error.status !== 403) return error;
    const otherRegion = this.baseUrl.includes('logfire-us')
      ? 'https://logfire-eu.pydantic.dev'
      : 'https://logfire-us.pydantic.dev';
    return new Error(
      `${error.message} — Logfire rejected the token. Either it belongs to the other data region (try LOGFIRE_BASE_URL=${otherRegion}), or it is not a read-scope token (the query API rejects write tokens; create one under Project Settings → Read Tokens).`,
    );
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
    const rows = await this.query<{ service_name?: string | null }>(
      'SELECT DISTINCT service_name FROM records WHERE service_name IS NOT NULL LIMIT 200',
    );
    return {
      services: rows
        .map((row) => row.service_name ?? '')
        .filter((name) => name.length > 0),
    };
  }

  async listOperations(serviceName: string): Promise<OperationListResult> {
    const rows = await this.query<{ span_name?: string | null }>(
      `SELECT DISTINCT span_name FROM records WHERE service_name = '${escapeSqlString(serviceName)}' LIMIT 500`,
    );
    return {
      operations: rows
        .map((row) => row.span_name ?? '')
        .filter((name) => name.length > 0),
    };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const where: string[] = [];
    if (query.service) {
      where.push(`service_name = '${escapeSqlString(query.service)}'`);
    }
    if (query.operation) {
      where.push(`span_name = '${escapeSqlString(query.operation)}'`);
    }
    if (query.hasError) where.push('is_exception = TRUE');
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

    const limit = query.limit ?? 20;
    const rows = await this.query<LogfireSpanRow>(
      `SELECT ${SPAN_COLUMNS} FROM records${clause} ORDER BY start_timestamp DESC LIMIT ${limit * SPANS_PER_TRACE_ESTIMATE}`,
      query.startTimeUnixMs,
    );

    // Duration and error filters apply to the assembled trace, not the row, so
    // they run client-side once the spans are grouped.
    const items = rowsToTraces(rows)
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, limit);
    return { items, totalCount: items.length };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const rows = await this.query<LogfireSpanRow>(
      `SELECT ${SPAN_COLUMNS} FROM records WHERE trace_id = '${escapeSqlString(traceId)}' ORDER BY start_timestamp ASC LIMIT 1000`,
    );
    return rowsToTraces(rows)[0] ?? null;
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    const traceResult = await this.searchTraces(query);
    const spans = traceResult.items.flatMap((trace) => trace.spans);
    // Trace-level aggregates were already applied by searchTraces.
    const spanQuery = query.filters ? { ...query, filters: undefined } : query;
    const items = spans
      .filter((span) => spanMatchesQuery(span, spanQuery))
      .slice(0, query.limit ?? 50);
    return { items, totalCount: items.length };
  }

  async serviceMap(_lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const services = await this.listServices();
    const perServiceLimit = Math.max(limit, 20);
    const results = await Promise.all(
      services.services.map((service) =>
        this.searchTraces({ service, limit: perServiceLimit }),
      ),
    );
    const deduped = new Map<string, TraceRecord>();
    for (const result of results) {
      for (const trace of result.items) deduped.set(trace.traceId, trace);
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
      detail: 'The Logfire query API backend serves traces only',
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
      detail: 'The Logfire query API backend serves traces only',
    };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);
    return { trace, metrics: [], logs: [] };
  }
}

/** Group a flat span list into traces, preserving attributes verbatim. */
export function rowsToTraces(rows: LogfireSpanRow[]): TraceRecord[] {
  const byTraceId = new Map<string, SpanRecord[]>();

  for (const row of rows) {
    const startMs = Date.parse(row.start_timestamp);
    const endMs = Date.parse(row.end_timestamp);
    const tags = Object.fromEntries(
      Object.entries(row.attributes ?? {}).map(([key, value]) => [
        key,
        normalizeTagValue(value),
      ]),
    );
    const span: SpanRecord = {
      traceId: row.trace_id,
      spanId: row.span_id,
      parentSpanId: row.parent_span_id ?? null,
      operationName: row.span_name,
      serviceName: row.service_name ?? 'unknown',
      startTimeUnixMs: startMs,
      durationMs: endMs - startMs,
      tags,
      hasError: row.is_exception === true,
      statusCode: row.is_exception === true ? 'ERROR' : 'UNSET',
    };
    const existing = byTraceId.get(row.trace_id);
    if (existing) existing.push(span);
    else byTraceId.set(row.trace_id, [span]);
  }

  return Array.from(byTraceId, ([traceId, spans]) => ({ traceId, spans }));
}
