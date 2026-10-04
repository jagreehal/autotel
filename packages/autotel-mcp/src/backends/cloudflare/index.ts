/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Rows arrive from Cloudflare's SQL API as JSON, where `attributes` is an open map of unread values and bound parameters are an open name→value map. `explainFailure` rewrites a caught error, which the language types as `unknown` going in and which passes straight back out to a `throw` when there is nothing to add. */

import { HttpError, jsonPost } from '../../lib/http';
import type {
  BackendCapabilities,
  BackendHealth,
  CorrelatedSignals,
  LogRecord,
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
 * Cloudflare Observability: traces and Workers logs over the unified SQL API
 * (`POST /client/v4/analytics/sql`, beta).
 *
 * `logs.traces` holds every span Cloudflare stores: Workers' automatic spans
 * (handler, `fetch`, bindings), custom spans (including autotel's under native
 * tracing) and Cloudflare Traces' edge spans. Ids are W3C hex, so the mapping
 * is a rename. `logs.workersLogs` carries `console.*` output and invocation
 * events, keyed by `traceId` and `rayId`.
 *
 * Checked against the live API (Oct 2026):
 *
 * - every query needs a time range, sent as `time_range`; without one: 422
 * - timestamps come back as `YYYY-MM-DD HH:MM:SS.mmm` in UTC, without a zone
 * - sampled datasets reject `MIN`/`MAX`, so recency is `ORDER BY ... LIMIT`
 * - errors are `422 text/plain` with a message naming the bad column, which
 *   `explainFailure` passes on to the caller
 * - `parentSpanId`/`spanId`/`error` are `''` rather than null when absent
 * - sampling adapts to window width: one trace read back whole over two days
 *   and as one span in ten over three, so traces hydrate in narrow windows
 *
 * Needs an API token with Account Analytics Read for the account.
 */

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';

/** Fallback window when the caller gave none; a bound is mandatory. */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Slack either side of a trace's first-seen span when hydrating it. */
const HYDRATE_PAD_MS = 60 * 60 * 1000;
/** Widest single hydration window; beyond it each trace gets its own query. */
const HYDRATE_MAX_WINDOW_MS = 6 * 60 * 60 * 1000;

const SPAN_COLUMNS = [
  'traceId',
  'spanId',
  'parentSpanId',
  'spanName',
  'serviceName',
  'startTime',
  'durationMs',
  'httpStatus',
  'error',
  'sampleInterval',
  'attributes',
].join(', ');

interface CloudflareSpanRow {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  spanName: string;
  serviceName?: string | null;
  startTime: string;
  durationMs?: number | null;
  httpStatus?: number | null;
  error?: string | null;
  sampleInterval?: number | null;
  attributes?: Record<string, unknown> | null;
}

interface CloudflareLogRow {
  timestamp: string;
  level?: string | null;
  message?: string | null;
  scriptName?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  rayId?: string | null;
  attributes?: Record<string, unknown> | null;
}

interface SqlResponse<Row> {
  data?: Row[];
}

interface TimeRange {
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
}

export interface CloudflareBackendOptions {
  accountId: string;
  apiToken: string;
  /** API base, `https://api.cloudflare.com/client/v4` unless proxied. */
  baseUrl?: string;
}

/** Cloudflare's zone-less UTC timestamp, as epoch ms. */
export function parseCloudflareTime(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

export class CloudflareBackend implements TelemetryBackend {
  readonly kind = 'cloudflare' as const;

  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(options: CloudflareBackendOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async query<Row>(
    sql: string,
    params: Record<string, string | number>,
    range: TimeRange = {},
  ): Promise<Row[]> {
    if (!this.apiToken || !this.accountId) {
      throw new Error(
        'Cloudflare credentials missing. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with Account Analytics Read).',
      );
    }
    const end = range.endTimeUnixMs ?? Date.now();
    const start = range.startTimeUnixMs ?? end - DEFAULT_LOOKBACK_MS;
    try {
      const body = await jsonPost<SqlResponse<Row>>(
        `${this.baseUrl}/analytics/sql`,
        {
          query: sql,
          params,
          scope: { accountTag: this.accountId },
          time_range: {
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
          },
        },
        { Authorization: `Bearer ${this.apiToken}` },
      );
      return body.data ?? [];
    } catch (error) {
      throw explainFailure(error);
    }
  }

  async healthCheck(): Promise<BackendHealth> {
    try {
      const services = await this.listServices();
      return {
        healthy: true,
        message: `${services.services.length} services with spans in the last 24h`,
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
      logs: 'available',
    };
  }

  async listServices(_query?: ServiceQuery): Promise<ServiceListResult> {
    const rows = await this.query<{ serviceName?: string | null }>(
      "SELECT serviceName, count(*) AS n FROM logs.traces WHERE serviceName != '' GROUP BY serviceName ORDER BY n DESC LIMIT 200",
      {},
    );
    return {
      services: rows
        .map((row) => row.serviceName ?? '')
        .filter((name) => name.length > 0),
    };
  }

  async listOperations(service: string): Promise<OperationListResult> {
    const rows = await this.query<{ spanName?: string | null }>(
      'SELECT spanName, count(*) AS n FROM logs.traces WHERE serviceName = $service GROUP BY spanName ORDER BY n DESC LIMIT 500',
      { service },
    );
    return {
      operations: rows
        .map((row) => row.spanName ?? '')
        .filter((name) => name.length > 0),
    };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (query.service) {
      where.push('serviceName = $service');
      params.service = query.service;
    }
    if (query.operation) {
      where.push('spanName = $operation');
      params.operation = query.operation;
    }
    if (query.hasError) where.push("error != ''");
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const range = {
      startTimeUnixMs: query.startTimeUnixMs,
      endTimeUnixMs: query.endTimeUnixMs,
    };

    // No MAX on sampled datasets: take the newest matching spans and dedupe.
    const limit = query.limit ?? 20;
    const matches = await this.query<{ traceId: string; startTime: string }>(
      `SELECT traceId, startTime FROM logs.traces${clause} ORDER BY startTime DESC LIMIT ${Math.min(limit * 20, 2000)}`,
      params,
      range,
    );
    const starts = new Map<string, number>();
    for (const row of matches) {
      if (row.traceId && !starts.has(row.traceId) && starts.size < limit) {
        starts.set(row.traceId, parseCloudflareTime(row.startTime));
      }
    }
    if (starts.size === 0) return { items: [], totalCount: 0 };

    const rows = await this.hydrate(starts);
    // Trace-level filters apply only once every selected trace is hydrated.
    const items = rowsToTraces(rows)
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, limit);
    return { items, totalCount: items.length };
  }

  private spansFor(
    traceIds: string[],
    range: TimeRange,
  ): Promise<CloudflareSpanRow[]> {
    const params = Object.fromEntries(
      traceIds.map((id, index) => [`t${index}`, id]),
    );
    const placeholders = traceIds.map((_, index) => `$t${index}`).join(', ');
    return this.query<CloudflareSpanRow>(
      `SELECT ${SPAN_COLUMNS} FROM logs.traces WHERE traceId IN (${placeholders}) ORDER BY startTime ASC LIMIT ${Math.min(traceIds.length * 1000, 10_000)}`,
      params,
      range,
    );
  }

  /**
   * Fetch whole traces in narrow windows around their start times. The
   * dataset samples by window width and volume (a 2-day window came back
   * complete, 3 days 1-in-10), so narrow windows return every span.
   */
  private async hydrate(
    starts: Map<string, number>,
  ): Promise<CloudflareSpanRow[]> {
    const times = [...starts.values()];
    const from = Math.min(...times) - HYDRATE_PAD_MS;
    const to = Math.max(...times) + HYDRATE_PAD_MS;
    if (to - from <= HYDRATE_MAX_WINDOW_MS) {
      return this.spansFor([...starts.keys()], {
        startTimeUnixMs: from,
        endTimeUnixMs: to,
      });
    }
    const perTrace = await Promise.all(
      [...starts].map(([traceId, start]) =>
        this.spansFor([traceId], {
          startTimeUnixMs: start - HYDRATE_PAD_MS,
          endTimeUnixMs: start + HYDRATE_PAD_MS,
        }),
      ),
    );
    return perTrace.flat();
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    // A trace id carries no time, and a wide window is sampled: walk back a
    // day at a time over a week (free-plan retention) to find it, then
    // hydrate tightly around its start.
    const now = Date.now();
    for (let day = 0; day < 7; day++) {
      const found = await this.query<{ startTime: string }>(
        'SELECT startTime FROM logs.traces WHERE traceId = $t ORDER BY startTime ASC LIMIT 1',
        { t: traceId },
        {
          startTimeUnixMs: now - (day + 1) * DEFAULT_LOOKBACK_MS,
          endTimeUnixMs: now - day * DEFAULT_LOOKBACK_MS,
        },
      );
      if (found[0]) {
        const rows = await this.hydrate(
          new Map([[traceId, parseCloudflareTime(found[0].startTime)]]),
        );
        return rowsToTraces(rows)[0] ?? null;
      }
    }
    return null;
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

  async serviceMap(lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const startTimeUnixMs = Date.now() - lookbackMinutes * 60_000;
    const services = await this.listServices();
    const results = await Promise.all(
      services.services.map((service) =>
        this.searchTraces({
          service,
          limit: Math.max(limit, 20),
          startTimeUnixMs,
        }),
      ),
    );
    const deduped = new Map<string, TraceRecord>();
    for (const result of results) {
      for (const trace of result.items) deduped.set(trace.traceId, trace);
    }
    return buildServiceMap([...deduped.values()], limit);
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    const trace = await this.getTrace(traceId);
    return trace ? summarizeTrace(trace) : null;
  }

  async listMetrics(_query?: MetricSearchQuery): Promise<MetricSearchResult> {
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail:
        'The Cloudflare backend serves traces and Workers logs; Cloudflare does not export metrics over this API yet',
    };
  }

  async getMetricSeries(
    _name: string,
    _query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    return [];
  }

  async searchLogs(query: LogSearchQuery = {}): Promise<LogSearchResult> {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    const filters: Array<[string | undefined, string, string]> = [
      [query.serviceName, 'scriptName', 'service'],
      [query.traceId, 'traceId', 'traceId'],
      [query.spanId, 'spanId', 'spanId'],
      [query.severityText?.toLowerCase(), 'level', 'level'],
    ];
    for (const [value, column, name] of filters) {
      if (!value) continue;
      where.push(`${column} = $${name}`);
      params[name] = value;
    }
    if (query.text) {
      where.push('message LIKE $text');
      params.text = `%${query.text}%`;
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const rows = await this.query<CloudflareLogRow>(
      `SELECT timestamp, level, message, scriptName, traceId, spanId, rayId, attributes FROM logs.workersLogs${clause} ORDER BY timestamp DESC LIMIT ${query.limit ?? 100}`,
      params,
      query,
    );
    const items = rows
      .map(rowToLog)
      .filter((log) =>
        Object.entries(query.attributes ?? {}).every(
          ([key, value]) => log.attributes?.[key] === value,
        ),
      );
    return { items, totalCount: items.length };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);
    if (!trace) return { trace, metrics: [], logs: [] };
    // Logs sample by window width too, so read them in the trace's own window.
    const start = Math.min(...trace.spans.map((s) => s.startTimeUnixMs));
    const logs = await this.searchLogs({
      traceId,
      startTimeUnixMs: start - HYDRATE_PAD_MS,
      endTimeUnixMs: start + HYDRATE_PAD_MS,
    });
    return { trace, metrics: [], logs: logs.items };
  }
}

function explainFailure(error: unknown): unknown {
  if (!(error instanceof HttpError)) return error;
  if (error.status === 401 || error.status === 403) {
    return new Error(
      `${error.message} — Cloudflare rejected the token. It needs Account Analytics Read on account CLOUDFLARE_ACCOUNT_ID.`,
    );
  }
  return error.body ? new Error(`${error.message} — ${error.body}`) : error;
}

function tagsOf(
  attributes: Record<string, unknown> | null | undefined,
): Record<string, ReturnType<typeof normalizeTagValue>> {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).map(([key, value]) => [
      key,
      normalizeTagValue(value),
    ]),
  );
}

/** Group a flat span list into traces, preserving attributes verbatim. */
export function rowsToTraces(rows: CloudflareSpanRow[]): TraceRecord[] {
  const byTraceId = new Map<string, SpanRecord[]>();
  for (const row of rows) {
    const error = row.error || undefined;
    const tags = tagsOf(row.attributes);
    if (row.httpStatus != null && tags['http.response.status_code'] == null) {
      tags['http.response.status_code'] = row.httpStatus;
    }
    if (error !== undefined) tags['otel.status_description'] = error;
    // A sampled row represents this many spans.
    if ((row.sampleInterval ?? 1) > 1) {
      tags['cloudflare.sample_interval'] = row.sampleInterval!;
    }
    const span: SpanRecord = {
      traceId: row.traceId,
      spanId: row.spanId,
      parentSpanId: row.parentSpanId || null,
      operationName: row.spanName,
      serviceName: row.serviceName || 'unknown',
      startTimeUnixMs: parseCloudflareTime(row.startTime),
      durationMs: row.durationMs ?? 0,
      tags,
      hasError: error !== undefined,
      statusCode: error === undefined ? 'UNSET' : 'ERROR',
    };
    const existing = byTraceId.get(row.traceId);
    if (existing) existing.push(span);
    else byTraceId.set(row.traceId, [span]);
  }
  return [...byTraceId].map(([traceId, spans]) => ({ traceId, spans }));
}

export function rowToLog(row: CloudflareLogRow): LogRecord {
  const attributes = tagsOf(row.attributes);
  if (row.rayId) attributes['cloudflare.ray_id'] = row.rayId;
  const log: LogRecord = {
    timestampUnixMs: parseCloudflareTime(row.timestamp),
    severityText: (row.level || 'info').toUpperCase(),
    body: row.message ?? '',
    attributes,
  };
  if (row.scriptName) log.serviceName = row.scriptName;
  if (row.traceId) log.traceId = row.traceId;
  if (row.spanId) log.spanId = row.spanId;
  return log;
}
