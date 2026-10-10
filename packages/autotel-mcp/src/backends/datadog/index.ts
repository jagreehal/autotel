/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- These types describe Datadog's API payloads as it arrives on the wire, where an attribute bag genuinely is an open dictionary of unread values. The tag maps built from them are open by the same token: an attribute set is not a fixed field list. */

import { HttpError, jsonGet, jsonPost } from '../../lib/http';
import type {
  BackendCapabilities,
  BackendHealth,
  CorrelatedSignals,
  LogSearchQuery,
  LogRecord,
  LogSearchResult,
  MetricSearchQuery,
  MetricSearchResult,
  MetricPoint,
  MetricSeries,
  MetricSeriesQuery,
  OperationListResult,
  ServiceListResult,
  ServiceMap,
  ServiceQuery,
  SpanRecord,
  SpanSearchQuery,
  SpanSearchResult,
  TagValue,
  TraceRecord,
  TraceSearchQuery,
  TraceSearchResult,
  TraceSummary,
} from '../../types';
import type { SpanAggregateQuery, TelemetryBackend } from '../telemetry';
import type { SpanAggregateRow } from '../../modules/span-aggregate';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../../modules/query-filters';
import { buildServiceMap } from '../../modules/service-map';
import { summarizeTrace } from '../../modules/trace-summary';
import { normalizeTagValue } from '../span-mapping';
import { asNumber, asRecord } from '../../lib/values';

/**
 * Datadog: traces over the v2 spans search API, logs over the v2 logs search,
 * metrics over the v1 query API.
 *
 *   POST /api/v2/spans/events/search   search spans
 *   POST /api/v2/logs/events/search    search logs
 *   GET  /api/v2/apm/services          list APM services
 *
 * Auth needs **two** credentials: an org API key and a personal application
 * key. Datadog's base URL is region-specific (US1/US3/US5/EU1/AP1).
 *
 * Search returns flat spans, not traces, so results are grouped by `trace_id`
 * here. Every search is given an explicit `from`/`to`: without one Datadog
 * applies a short default window, which makes a lookup of an older trace come
 * back empty rather than erroring — a silent wrong answer.
 *
 * The spans search API is tightly rate limited (5 requests a minute on some
 * orgs), so a trace search costs two requests whatever its limit: one to find
 * trace ids, one `trace_id:(a OR b …)` to hydrate them all.
 */

/** Datadog's default search window when the caller gives no bounds. */
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;

/** The spans search page maximum; a full page means spans were cut off. */
const MAX_PAGE = 1000;

/** How far back a by-id trace lookup reaches. */
const TRACE_LOOKUP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const NS_PER_MS = 1_000_000;

interface DatadogSpanAttributes {
  service?: string;
  resource_name?: string;
  /** Legacy/alternate epoch-nanosecond value. */
  start?: string | number;
  start_timestamp?: string;
  end_timestamp?: string;
  /** Legacy/alternate duration in nanoseconds. */
  duration?: number;
  trace_id?: string;
  span_id?: string;
  parent_id?: string;
  type?: string;
  status?: string;
  /** `{ message, type, stack }` on a failed span. */
  error?: Record<string, unknown> | null;
  /** Indexed tags are returned as `key:value` strings. */
  tags?: string[] | Record<string, string>;
  /** Original OTel span attributes. */
  attributes?: Record<string, unknown>;
  custom?: Record<string, unknown>;
}

interface DatadogSpanEvent {
  id?: string;
  type?: string;
  attributes?: DatadogSpanAttributes;
}

interface DatadogSearchResponse {
  data?: DatadogSpanEvent[];
}

interface DatadogLogEvent {
  attributes?: {
    timestamp?: string;
    status?: string;
    message?: string;
    service?: string;
    tags?: string[];
    /** Log attributes, nested (`otel.trace_id` arrives as `{ otel: { trace_id } }`). */
    attributes?: Record<string, unknown>;
  };
}

interface DatadogMetricQueryResponse {
  series?: Array<{
    metric?: string;
    scope?: string;
    pointlist?: Array<[number, number | null]>;
    unit?: Array<{ name?: string } | null>;
  }>;
}

interface DatadogAggregateResponse {
  data?: Array<{
    attributes?: {
      by?: Record<string, unknown>;
      compute?: Record<string, unknown>;
    };
  }>;
}

interface DatadogServicesResponse {
  data?: {
    id?: string;
    type?: string;
    attributes?: { services?: string[] };
  };
}

export interface DatadogBackendOptions {
  /**
   * Datadog site (`datadoghq.eu`, `us5.datadoghq.com`, …) or a full API base
   * URL. A bare site is the common case — it is what Datadog's own `DD_SITE`
   * holds — so it is accepted and expanded rather than rejected.
   */
  baseUrl: string;
  apiKey: string;
  appKey: string;
}

/** Default site when nothing is configured. */
const DEFAULT_BASE_URL = 'https://api.datadoghq.com';

/**
 * Normalise whatever the user configured into an API base URL.
 *
 * Datadog documents a *site* (`datadoghq.eu`) while the REST API lives on
 * `api.<site>`, so both forms show up in practice. Passing a bare site straight
 * to `new URL()` throws "Invalid URL", which names neither the variable at
 * fault nor the fix.
 */
export function resolveDatadogBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return DEFAULT_BASE_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A site that already carries the api. host shouldn't become api.api.…
  const host = trimmed.startsWith('api.') ? trimmed : `api.${trimmed}`;
  return `https://${host}`;
}

/**
 * Datadog reports span start either as epoch-nanosecond digits or as an ISO
 * timestamp depending on the shape. Treating one as the other yields dates in
 * 1970 or in the far future, so decide by looking at the value.
 */
export function parseStartMs(start: string | number | undefined): number {
  if (start === undefined) return 0;
  const startNs = asNumber(start);
  if (startNs !== undefined) return Math.floor(startNs / NS_PER_MS);
  const parsed = Date.parse(String(start));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export class DatadogBackend implements TelemetryBackend {
  readonly kind = 'datadog' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appKey: string;

  constructor(options: DatadogBackendOptions) {
    this.baseUrl = resolveDatadogBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.appKey = options.appKey;
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error('Datadog API key missing. Set DD_API_KEY.');
    }
    if (!this.appKey) {
      throw new Error(
        'Datadog application key missing. Set DD_APP_KEY (an application key is separate from the API key).',
      );
    }
    return {
      'DD-API-KEY': this.apiKey,
      'DD-APPLICATION-KEY': this.appKey,
    };
  }

  private async search(
    query: string,
    fromMs: number,
    toMs: number,
    limit: number,
  ): Promise<DatadogSpanEvent[]> {
    const headers = this.authHeaders();
    const body = await jsonPost<DatadogSearchResponse>(
      new URL('/api/v2/spans/events/search', this.baseUrl).toString(),
      {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query: query || '*',
              from: new Date(fromMs).toISOString(),
              to: new Date(toMs).toISOString(),
            },
            options: { timezone: 'UTC' },
            page: { limit },
            sort: '-timestamp',
          },
        },
      },
      headers,
    ).catch(explainRateLimit);
    return body.data ?? [];
  }

  async healthCheck(): Promise<BackendHealth> {
    try {
      // The catalog only: listServices also spends a spans-API request.
      const services = await this.catalogServices();
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
      metrics: 'available',
      logs: 'available',
    };
  }

  /**
   * The APM catalog plus every service with spans in the last day, which
   * covers services that only send OTLP spans. The span count costs a
   * spans-API request; if Datadog refuses it, the catalog alone answers.
   */
  async listServices(_query?: ServiceQuery): Promise<ServiceListResult> {
    const catalog = await this.catalogServices();
    const toMs = Date.now();
    const withSpans = await this.aggregateSpans({
      groupBy: ['service'],
      startTimeUnixMs: toMs - 24 * 60 * 60 * 1000,
      endTimeUnixMs: toMs,
      limit: 100,
      countOnly: true,
    })
      .then((rows) => rows ?? [])
      .catch(() => []);
    const names = new Set([
      ...catalog.services,
      ...withSpans.map((row) => row.group.service!).filter(Boolean),
    ]);
    return { services: Array.from(names).sort() };
  }

  private async catalogServices(): Promise<ServiceListResult> {
    const headers = this.authHeaders();
    const url = new URL('/api/v2/apm/services', this.baseUrl);
    url.searchParams.set('filter[env]', '*');
    const body = await jsonGet<DatadogServicesResponse>(url.toString(), {
      headers,
    });
    return {
      services: body.data?.attributes?.services ?? [],
    };
  }

  async listOperations(serviceName: string): Promise<OperationListResult> {
    const traces = await this.searchTraces({ service: serviceName, limit: 50 });
    const operations = new Set<string>();
    for (const trace of traces.items) {
      for (const span of trace.spans) {
        if (span.serviceName === serviceName)
          operations.add(span.operationName);
      }
    }
    return { operations: Array.from(operations) };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const toMs = query.endTimeUnixMs ?? Date.now();
    const fromMs = query.startTimeUnixMs ?? toMs - DEFAULT_LOOKBACK_MS;
    const limit = query.limit ?? 20;
    const events = await this.search(
      spanFilter(query),
      fromMs,
      toMs,
      Math.min(limit * 20, 1000),
    );
    const traceIds = Array.from(
      new Set(
        events
          .map((event) => event.attributes?.trace_id)
          .filter((traceId): traceId is string => Boolean(traceId)),
      ),
    ).slice(0, limit);
    if (traceIds.length === 0) return { items: [], totalCount: 0 };
    // One hydration request for every trace: the filter matched only some
    // spans of each, and the rest (downstream services) matter.
    const hydrated = await this.search(
      `trace_id:(${traceIds.join(' OR ')})`,
      fromMs,
      toMs,
      MAX_PAGE,
    );
    // A trace crowded out of a full shared page keeps the spans the first
    // search matched.
    const truncated = hydrated.length >= MAX_PAGE;
    const matched = new Map(groupSpans(events).map((t) => [t.traceId, t]));
    const byId = new Map(groupSpans(hydrated).map((t) => [t.traceId, t]));
    const items = traceIds
      .map((traceId) => byId.get(traceId) ?? matched.get(traceId))
      .filter((trace): trace is TraceRecord => trace !== undefined)
      .map((trace) => (truncated ? { ...trace, truncated } : trace))
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, limit);
    return { items, totalCount: items.length };
  }

  /**
   * The UI host differs from the API host by region: US1 and EU1 are
   * `app.<site>`, the others (us3, us5, ap1, …) are the site itself.
   */
  traceUrl(traceId: string): string {
    const site = new URL(this.baseUrl).host.replace(/^api\./, '');
    const ui = /^datadoghq\.(com|eu)$/.test(site) ? `app.${site}` : site;
    return `https://${ui}/apm/trace/${encodeURIComponent(traceId)}`;
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const toMs = Date.now();
    const events = await this.search(
      `trace_id:${traceId}`,
      toMs - TRACE_LOOKUP_LOOKBACK_MS,
      toMs,
      MAX_PAGE,
    );
    const trace = groupSpans(events).find((t) => t.traceId === traceId);
    if (!trace) return null;
    return events.length >= MAX_PAGE ? { ...trace, truncated: true } : trace;
  }

  /**
   * One request, straight to the spans: no trace hydration. Aggregation and
   * span search need the matching spans, not the traces around them, and the
   * spans API's rate limit makes every saved request count.
   */
  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    const toMs = query.endTimeUnixMs ?? Date.now();
    const fromMs = query.startTimeUnixMs ?? toMs - DEFAULT_LOOKBACK_MS;
    const limit = Math.min(query.limit ?? 50, MAX_PAGE);
    const events = await this.search(spanFilter(query), fromMs, toMs, limit);
    const items = groupSpans(events)
      .flatMap((trace) => trace.spans)
      .filter((span) => spanMatchesQuery(span, query))
      .sort((a, b) => b.startTimeUnixMs - a.startTimeUnixMs);
    // Tag, duration and structured filters run after the fetch, so the page
    // size decides truncation.
    return {
      items,
      totalCount: items.length,
      truncated: events.length >= limit,
    };
  }

  async serviceMap(lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const toMs = Date.now();
    const traces = await this.searchTraces({
      startTimeUnixMs: toMs - lookbackMinutes * 60 * 1000,
      endTimeUnixMs: toMs,
      limit: Math.max(limit, 20),
    });
    return buildServiceMap(traces.items, limit);
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    const trace = await this.getTrace(traceId);
    if (!trace) return null;
    return summarizeTrace(trace);
  }

  /** Metric names active in the window (`/api/v1/metrics`). */
  async listMetrics(query?: MetricSearchQuery): Promise<MetricSearchResult> {
    const url = new URL('/api/v1/metrics', this.baseUrl);
    const lookbackMs = (query?.lookbackMinutes ?? 24 * 60) * 60_000;
    url.searchParams.set(
      'from',
      String(Math.floor((Date.now() - lookbackMs) / 1000)),
    );
    if (query?.serviceName)
      url.searchParams.set('tag_filter', `service:${query.serviceName}`);
    const body = await jsonGet<{ metrics?: string[] }>(url.toString(), {
      headers: this.authHeaders(),
    });
    const names = (body.metrics ?? []).filter(
      (name) => !query?.metricName || name.includes(query.metricName),
    );
    const items = names
      .slice(0, query?.limit ?? 100)
      .map((metricName) => ({ metricName, points: [] }));
    return { items, totalCount: names.length };
  }

  /** One series per service (`/api/v1/query`, averaged across other tags). */
  async getMetricSeries(
    name: string,
    query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    const toMs = query?.endTimeUnixMs ?? Date.now();
    const fromMs = query?.startTimeUnixMs ?? toMs - DEFAULT_LOOKBACK_MS;
    const scope = query?.serviceName ? `service:${query.serviceName}` : '*';
    const url = new URL('/api/v1/query', this.baseUrl);
    url.searchParams.set('from', String(Math.floor(fromMs / 1000)));
    url.searchParams.set('to', String(Math.floor(toMs / 1000)));
    url.searchParams.set('query', `avg:${name}{${scope}} by {service}`);
    const body = await jsonGet<DatadogMetricQueryResponse>(url.toString(), {
      headers: this.authHeaders(),
    });
    return (body.series ?? []).slice(0, query?.limit ?? 100).map((series) => ({
      metricName: series.metric ?? name,
      unit: series.unit?.find((unit) => unit?.name)?.name,
      points: (series.pointlist ?? [])
        .filter((point): point is [number, number] => point[1] !== null)
        .map(([timestampUnixMs, value]): MetricPoint => ({
          timestampUnixMs,
          value,
        })),
      attributes: datadogTags(
        (series.scope ?? '').split(',').filter((tag) => tag !== '*'),
      ),
    }));
  }

  /**
   * Exact numbers over every span in the window, from Datadog's analytics
   * API rather than a sample. Two requests (all spans, then errors), since
   * one cannot count conditionally. Time buckets are left to the sample path.
   *
   * Service, operation and the error flag compile to Datadog's query. A query
   * with any other filter (tags, durations, status, structured filters)
   * returns `undefined`, and the caller samples, applying every filter.
   */
  async aggregateSpans(
    query: SpanAggregateQuery,
  ): Promise<SpanAggregateRow[] | undefined> {
    if (!canPushDown(query)) return undefined;
    const toMs = query.endTimeUnixMs ?? Date.now();
    const fromMs = query.startTimeUnixMs ?? toMs - DEFAULT_LOOKBACK_MS;
    const groupBy = query.groupBy ?? [];
    const facets = groupBy.map(datadogFacet);
    const filter = spanFilter(query);
    const compute = query.countOnly
      ? [{ aggregation: 'count', type: 'total' }]
      : [
          { aggregation: 'count', type: 'total' },
          // Datadog names the 50th percentile `median`.
          ...['avg', 'median', 'pc95', 'pc99', 'max'].map((aggregation) => ({
            aggregation,
            metric: '@duration',
            type: 'total',
          })),
        ];
    const request = (
      queryText: string,
      measures: object[],
      limits: number[] = facets.map(() => query.limit ?? 20),
    ) =>
      jsonPost<DatadogAggregateResponse>(
        new URL('/api/v2/spans/analytics/aggregate', this.baseUrl).toString(),
        {
          data: {
            type: 'aggregate_request',
            attributes: {
              compute: measures,
              filter: {
                query: queryText || '*',
                from: new Date(fromMs).toISOString(),
                to: new Date(toMs).toISOString(),
              },
              // Datadog orders groups alphabetically by default; sorting by
              // count makes the limit keep the busiest groups.
              group_by: facets.map((facet, index) => ({
                facet,
                limit: limits[index],
                sort: { aggregation: 'count', order: 'desc', type: 'measure' },
              })),
            },
          },
        },
        this.authHeaders(),
      ).catch(explainRateLimit);

    const totals = await request(filter, compute);
    const buckets = totals.data ?? [];
    // Count errors for exactly the groups the totals chose, with each level's
    // limit wide enough to hold all of them, so a group absent from the error
    // response has no errors.
    const values = facets.map((facet) =>
      Array.from(new Set(buckets.map((b) => b.attributes?.by?.[facet]))),
    );
    if (values.some((list) => list.some((value) => value === undefined)))
      return undefined;
    const restrict = facets.map(
      (facet, index) =>
        `${facet}:(${values[index]!.map((value) => quote(String(value))).join(' OR ')})`,
    );
    const errors =
      query.countOnly || buckets.length === 0
        ? { data: [] }
        : await request(
            [filter, 'status:error', ...restrict].filter(Boolean).join(' '),
            [{ aggregation: 'count', type: 'total' }],
            values.map((list) => list.length),
          );
    const keyOf = (by: Record<string, unknown> = {}) =>
      JSON.stringify(facets.map((facet) => String(by[facet] ?? '')));
    const errorCounts = new Map(
      (errors.data ?? []).map((bucket) => [
        keyOf(bucket.attributes?.by),
        asNumber(bucket.attributes?.compute?.c0) ?? 0,
      ]),
    );
    const ms = (ns: unknown) =>
      Math.round(((asNumber(ns) ?? 0) / NS_PER_MS) * 1000) / 1000;
    return (
      buckets
        .map((bucket) => {
          const by = bucket.attributes?.by ?? {};
          const c = bucket.attributes?.compute ?? {};
          const count = asNumber(c.c0) ?? 0;
          const errorCount = errorCounts.get(keyOf(by)) ?? 0;
          return {
            group: Object.fromEntries(
              groupBy.map((field, index) => [
                field,
                String(by[facets[index]!] ?? '(none)'),
              ]),
            ),
            count,
            errorCount,
            errorRate:
              count === 0 ? 0 : Math.round((errorCount / count) * 1000) / 1000,
            avgMs: ms(c.c1),
            p50Ms: ms(c.c2),
            p95Ms: ms(c.c3),
            p99Ms: ms(c.c4),
            maxMs: ms(c.c5),
          };
        })
        .sort((a, b) => b.count - a.count)
        // Datadog's limit is per group-by level, so two levels of 20 can
        // return 400 buckets.
        .slice(0, query.limit ?? 20)
    );
  }

  async searchLogs(query: LogSearchQuery = {}): Promise<LogSearchResult> {
    const headers = this.authHeaders();
    const toMs = query.endTimeUnixMs ?? Date.now();
    const fromMs = query.startTimeUnixMs ?? toMs - DEFAULT_LOOKBACK_MS;
    const filter = [
      query.serviceName ? `service:${quote(query.serviceName)}` : '',
      // Datadog remaps OTLP `otel.trace_id` onto its reserved trace_id.
      query.traceId ? `trace_id:${query.traceId}` : '',
      query.spanId ? `@otel.span_id:${query.spanId}` : '',
      query.severityText ? `status:${query.severityText.toLowerCase()}` : '',
      ...Object.entries(query.attributes ?? {}).map(
        ([key, value]) => `@${key}:${quote(String(value))}`,
      ),
      query.text ? quote(query.text) : '',
    ]
      .filter((part) => part.length > 0)
      .join(' ');
    const limit = Math.min(query.limit ?? 50, 1000);
    const body = await jsonPost<{ data?: DatadogLogEvent[] }>(
      new URL('/api/v2/logs/events/search', this.baseUrl).toString(),
      {
        filter: {
          query: filter || '*',
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
        },
        page: { limit },
        sort: '-timestamp',
      },
      headers,
    ).catch(explainRateLimit);
    const items = (body.data ?? []).map(toLogRecord);
    return { items, totalCount: items.length };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const [trace, logs] = await Promise.all([
      this.getTrace(traceId),
      this.searchLogs({
        traceId,
        startTimeUnixMs: Date.now() - TRACE_LOOKUP_LOOKBACK_MS,
        limit: 200,
      }),
    ]);
    return { trace, metrics: [], logs: logs.items };
  }
}

/** Group flat span events into traces. Events with no resolvable trace id are dropped. */
export function groupSpans(events: DatadogSpanEvent[]): TraceRecord[] {
  const byTraceId = new Map<string, SpanRecord[]>();

  for (const event of events) {
    const attributes = event.attributes ?? {};
    const traceId = attributes.trace_id;
    if (!traceId) continue;

    const startTimeUnixMs = parseStartMs(
      attributes.start_timestamp ?? attributes.start,
    );
    const endTimeUnixMs = attributes.end_timestamp
      ? Date.parse(attributes.end_timestamp)
      : Number.NaN;
    // Timestamps carry only millisecond precision; the nanosecond duration
    // (top level, or under `custom` for OTLP spans) is the accurate one.
    const durationNs =
      asNumber(attributes.duration) ?? asNumber(attributes.custom?.duration);
    const durationMs =
      durationNs !== undefined
        ? durationNs / NS_PER_MS
        : Number.isNaN(endTimeUnixMs)
          ? 0
          : Math.max(0, endTimeUnixMs - startTimeUnixMs);
    const isError = attributes.status === 'error';
    const tags: Record<string, TagValue> = {
      ...datadogTags(attributes.tags),
      ...flattenTags(attributes.attributes),
      ...flattenTags(attributes.custom),
      ...flattenTags(attributes.error ?? undefined, 'error.'),
    };
    delete tags.duration;
    if (attributes.type) tags['datadog.type'] = attributes.type;

    const span: SpanRecord = {
      traceId,
      spanId: attributes.span_id ?? event.id ?? '',
      // Datadog marks a root with parent_id "0", not an absent parent.
      parentSpanId:
        attributes.parent_id && attributes.parent_id !== '0'
          ? attributes.parent_id
          : null,
      operationName: attributes.resource_name ?? 'span',
      serviceName: attributes.service ?? 'unknown',
      startTimeUnixMs,
      durationMs,
      tags,
      hasError: isError,
      statusCode: isError ? 'ERROR' : 'OK',
    };

    const existing = byTraceId.get(traceId);
    if (existing) existing.push(span);
    else byTraceId.set(traceId, [span]);
  }

  return Array.from(byTraceId, ([traceId, spans]) => ({ traceId, spans }));
}

/**
 * Datadog returns attributes nested (`{ http: { method: 'GET' } }`); tags are
 * flat dotted keys (`http.method`).
 */
export function flattenTags(
  values: Record<string, unknown> | undefined,
  prefix = '',
): Record<string, TagValue> {
  const tags: Record<string, TagValue> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === null || value === undefined) continue;
    const nested = asRecord(value);
    if (nested) Object.assign(tags, flattenTags(nested, `${prefix}${key}.`));
    else tags[`${prefix}${key}`] = normalizeTagValue(value);
  }
  return tags;
}

function toLogRecord(event: DatadogLogEvent): LogRecord {
  const attributes = event.attributes ?? {};
  const fields = flattenTags(attributes.attributes);
  const traceId = fields['otel.trace_id'] ?? fields.trace_id;
  const spanId = fields['otel.span_id'] ?? fields.span_id;
  return {
    timestampUnixMs: attributes.timestamp
      ? Date.parse(attributes.timestamp)
      : 0,
    severityText: (attributes.status ?? 'info').toUpperCase(),
    body: attributes.message ?? '',
    serviceName: attributes.service,
    traceId: traceId === undefined ? undefined : String(traceId),
    spanId: spanId === undefined ? undefined : String(spanId),
    attributes: { ...datadogTags(attributes.tags), ...fields },
  };
}

/** Our field names to Datadog's: reserved attributes bare, the rest as `@`. */
function datadogFacet(field: string): string {
  if (field === 'operation') return 'resource_name';
  if (['service', 'version', 'env', 'status', 'resource_name'].includes(field))
    return field;
  return field.startsWith('@') ? field : `@${field}`;
}

/** True when every filter in the query compiles to `spanFilter`. */
function canPushDown(query: SpanAggregateQuery): boolean {
  return (
    Object.keys(query.tags ?? {}).length === 0 &&
    (query.filters ?? []).length === 0 &&
    query.statusCode === undefined &&
    query.minDurationMs === undefined &&
    query.maxDurationMs === undefined &&
    query.spanMinDurationMs === undefined &&
    query.spanMaxDurationMs === undefined
  );
}

function spanFilter(query: TraceSearchQuery): string {
  return [
    query.service ? `service:${quote(query.service)}` : '',
    query.operation ? `resource_name:${quote(query.operation)}` : '',
    query.hasError ? 'status:error' : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ');
}

/** Quote a search value when it holds characters Datadog's syntax would split on. */
function quote(value: string): string {
  return /[\s:()"]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * The retry in `jsonPost` rides out a short limit, but Datadog's spans search
 * resets per minute. Tell the agent to wait rather than retry in a loop.
 */
function explainRateLimit(error: unknown): never {
  if (error instanceof HttpError && error.status === 429) {
    throw new Error(
      `${error.message}: Datadog rate-limited this search (the spans API allows as few as 5 requests a minute). Wait about a minute before the next query, and prefer one broader search over many narrow ones.`,
    );
  }
  throw error;
}

function datadogTags(
  tags: string[] | Record<string, string> | undefined,
): Record<string, TagValue> {
  if (!Array.isArray(tags)) return flattenTags(tags);
  return Object.fromEntries(
    tags.map((tag) => {
      const separator = tag.indexOf(':');
      return separator === -1
        ? [tag, true]
        : [tag.slice(0, separator), tag.slice(separator + 1)];
    }),
  );
}
