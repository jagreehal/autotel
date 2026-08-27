/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- These types describe the autotel devtools payload as it arrives on the wire, where an attribute bag genuinely is an open dictionary of unread values. The tag maps built from them are open by the same token: an attribute set is not a fixed field list. */

import { HttpError, jsonGet, jsonPost } from '../../lib/http';
import { compileTraceQuery } from './query-pushdown';
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
import { nonEmptyString } from '../../lib/values';

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

/** Response from the store-backed query endpoint. */
interface DevtoolsQueryResponse {
  traces?: DevtoolsTrace[];
  nextCursor?: string | null;
}

/** One entry in devtools' metric catalogue. */
interface DevtoolsMetricEntry {
  name: string;
  kind: string;
  unit?: string;
  description?: string;
  seriesCount: number;
}

interface DevtoolsMetricsResponse {
  metrics?: DevtoolsMetricEntry[];
}

interface DevtoolsMetricPoint {
  timestamp: number;
  value?: number;
  count?: number;
  sum?: number;
}

interface DevtoolsMetricSeries {
  seriesId: string;
  name: string;
  unit?: string;
  kind: string;
  service: string;
  attributes: Record<string, unknown>;
  points: DevtoolsMetricPoint[];
}

interface DevtoolsSeriesResponse {
  series?: DevtoolsMetricSeries[];
}

interface DevtoolsHealthResponse {
  ok?: boolean;
  service?: string;
  version?: string;
  clients?: number;
}

interface DevtoolsTraceProjection extends TraceSummary {
  slowestSpans: Array<{
    spanId: string;
    name: string;
    service: string;
    durationMs: number;
    /** Opens the viewer on this span, with the window the trace lived in. */
    deepLink: string;
  }>;
  /** Opens the viewer on this trace, with the window it lived in. */
  deepLink: string;
}

/**
 * Reads telemetry from a running `autotel-devtools` receiver.
 *
 * devtools now keeps telemetry in a sqlite store and answers queries against
 * it, so filters are **pushed down** (`POST /api/query/traces`) and run as SQL
 * over the whole retained history rather than as a JavaScript pass over the
 * hundred-trace live tail. Metrics are read the same way.
 *
 * Older devtools servers have neither endpoint. Rather than requiring a version
 * match, each call falls back to the read-back API (`GET /v1/traces`) plus
 * autotel-mcp's shared client-side filters the first time a query endpoint
 * answers 404 — so this backend keeps working against a devtools the user has
 * not upgraded, just with a smaller window and no metrics.
 */
export class DevtoolsBackend implements TelemetryBackend {
  readonly kind = 'devtools' as const;

  /**
   * Whether the server has the store-backed query API.
   *
   * `undefined` until the first attempt tells us. Cached so a legacy server
   * costs one failed request per process, not one per query.
   */
  private hasQueryApi: boolean | undefined;

  constructor(private readonly baseUrl: string) {}

  private async fetchTraces(): Promise<DevtoolsTrace[]> {
    const data = await jsonGet<DevtoolsTracesResponse>(
      `${this.baseUrl}/v1/traces`,
    );
    return data.traces ?? [];
  }

  /**
   * Run a query server-side, or return null when this server cannot.
   *
   * Null means "fall back", not "no results" — conflating the two would report
   * an empty investigation against a server that simply predates the endpoint.
   */
  private async queryRecords(
    query: TraceSearchQuery,
    wanted: number,
    accepts: (trace: TraceRecord) => boolean,
    pushDownWindow = true,
  ): Promise<TraceRecord[] | null> {
    if (this.hasQueryApi === false) return null;

    try {
      const matches: TraceRecord[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | null | undefined;

      do {
        const body: Record<string, unknown> = {
          query: compileTraceQuery(query),
          // Trace-level predicates are applied after hydration. Read a useful
          // candidate page even when the caller only wants one final match.
          limit: 100,
        };
        if (cursor) body.cursor = cursor;
        if (
          pushDownWindow &&
          typeof query.startTimeUnixMs === 'number' &&
          typeof query.endTimeUnixMs === 'number'
        ) {
          body.window = {
            start: query.startTimeUnixMs,
            end: query.endTimeUnixMs,
          };
        }

        const data = await jsonPost<DevtoolsQueryResponse>(
          `${this.baseUrl}/api/query/traces`,
          body,
        );
        // Trusting a bare 200 here would be a correctness hole, not just a
        // robustness one: this path returns results as *already filtered*, so
        // anything answering on that URL with a trace-shaped body would have its
        // unfiltered output presented as matching the query. The query response
        // always carries `nextCursor` (null on the last page); the older
        // read-back shape carries `count` instead. Require the former.
        if (!('nextCursor' in data)) {
          this.hasQueryApi = false;
          return null;
        }
        this.hasQueryApi = true;
        for (const trace of data.traces ?? []) {
          const record = this.toTraceRecord(trace);
          if (accepts(record)) {
            matches.push(record);
          }
          if (matches.length >= wanted) return matches;
        }

        cursor = data.nextCursor;
        if (cursor && seenCursors.has(cursor)) break;
        if (cursor) seenCursors.add(cursor);
      } while (cursor);

      return matches;
    } catch (error) {
      // Any failure here is recoverable: the read-back path below answers the
      // same question less efficiently, and a working answer beats an error.
      // Only a definitive 404 proves this is a legacy server. A timeout or 5xx
      // is transient and must be probed again on the next investigation.
      if (error instanceof HttpError && error.status === 404) {
        this.hasQueryApi = false;
      }
      return null;
    }
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
        message: `autotel-devtools${version} reachable — ${traces.length} trace(s) captured${this.describeQueryApi()}`,
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
      // Metrics are served from the store. Logs still only stream to the UI
      // over WebSocket, so they stay unsupported here.
      metrics: 'available',
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
    // Preferred path: the filter runs as SQL against the whole retained
    // history, so the answer is not limited to what is still in the live tail.
    const pushed = await this.queryRecords(
      query,
      query.limit ?? 20,
      (trace) =>
        withinTimeWindow(trace, query) && traceMatchesQuery(trace, query),
    );
    if (pushed) {
      const items = pushed.slice(0, query.limit ?? 20);
      return { items, totalCount: items.length };
    }

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
    const wanted = query.limit ?? 50;
    const pushed = await this.queryRecords(
      query,
      wanted,
      (trace) =>
        trace.spans.some(
          (span) =>
            spanWithinTimeWindow(span, query) && spanMatchesQuery(span, query),
        ),
      // The devtools endpoint windows by trace start. A trace can begin before
      // the requested span window and still contain an in-window child.
      false,
    );
    const records =
      pushed ??
      (await this.fetchTraces()).map((trace) => this.toTraceRecord(trace));
    const filtered = records
      .flatMap((trace) => trace.spans)
      .filter(
        (span) =>
          spanWithinTimeWindow(span, query) && spanMatchesQuery(span, query),
      );
    const items = filtered.slice(0, query.limit ?? 50);
    return { items, totalCount: filtered.length };
  }

  async serviceMap(_lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const records = (await this.fetchTraces()).map((trace) =>
      this.toTraceRecord(trace),
    );
    return buildServiceMap(records, limit);
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    try {
      return await jsonGet<DevtoolsTraceProjection>(
        `${this.baseUrl}/api/traces/${encodeURIComponent(traceId)}/summary`,
      );
    } catch {
      // Older receivers do not expose the compact projection. Preserve
      // compatibility by deriving the same answer from the full trace.
    }
    const trace = await this.getTrace(traceId);
    if (!trace) return null;
    return summarizeTrace(trace);
  }

  async listMetrics(query?: MetricSearchQuery): Promise<MetricSearchResult> {
    let catalogue: DevtoolsMetricEntry[];
    try {
      const data = await jsonGet<DevtoolsMetricsResponse>(
        `${this.baseUrl}/api/metrics`,
      );
      catalogue = data.metrics ?? [];
    } catch {
      // A devtools predating the metrics API. Say why rather than reporting an
      // empty catalogue, which would read as "this service emits no metrics".
      return {
        items: [],
        totalCount: 0,
        unsupported: true,
        detail:
          'This autotel-devtools has no metrics API — upgrade it to read metrics',
      };
    }

    const filtered = query?.metricName
      ? catalogue.filter((entry) => entry.name.includes(query.metricName!))
      : catalogue;

    // A catalogue listing returns series shells: names and metadata, no points.
    // Fetching every series' points here would be one request per metric, and
    // the caller asks for points through `getMetricSeries`. Same shape the
    // Prometheus backend returns for its own listing.
    const items: MetricSeries[] = filtered
      .slice(0, query?.limit ?? 50)
      .map((entry) => {
        const attributes: Record<string, TagValue> = { kind: entry.kind };
        if (entry.description) attributes.description = entry.description;
        return {
          metricName: entry.name,
          unit: entry.unit,
          attributes,
          points: [],
        };
      });
    return { items, totalCount: filtered.length };
  }

  async getMetricSeries(
    name: string,
    query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    const body: Record<string, unknown> = { name };
    if (
      typeof query?.startTimeUnixMs === 'number' &&
      typeof query?.endTimeUnixMs === 'number'
    ) {
      body.window = { start: query.startTimeUnixMs, end: query.endTimeUnixMs };
    }

    let series: DevtoolsMetricSeries[];
    try {
      const data = await jsonPost<DevtoolsSeriesResponse>(
        `${this.baseUrl}/api/query/metrics`,
        body,
      );
      series = data.series ?? [];
    } catch {
      return [];
    }

    const filtered = query?.serviceName
      ? series.filter((s) => s.service === query.serviceName)
      : series;

    return filtered.slice(0, query?.limit ?? 20).map((s) => ({
      metricName: s.name,
      unit: s.unit,
      attributes: normalizeTags(s.attributes),
      points: s.points.map((point) => ({
        timestampUnixMs: point.timestamp,
        // A histogram point has no single value; its count is the closest
        // honest scalar, and it is what the sparkline in the UI shows too.
        value: point.value ?? point.count ?? 0,
      })),
    }));
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

  /** Report the store-backed query API in the health line, so a stale devtools is visible. */
  private describeQueryApi(): string {
    if (this.hasQueryApi === true) return ' (store-backed queries)';
    if (this.hasQueryApi === false) return ' (legacy read-back only)';
    return '';
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
  const attributeText = nonEmptyString(fromAttribute);
  if (attributeText !== undefined) {
    return attributeText;
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

function spanWithinTimeWindow(
  span: SpanRecord,
  query: SpanSearchQuery,
): boolean {
  const startMs = query.startTimeUnixMs ?? 0;
  const endMs = query.endTimeUnixMs ?? Number.POSITIVE_INFINITY;
  return span.startTimeUnixMs >= startMs && span.startTimeUnixMs <= endMs;
}
