import { jsonGet, jsonPost } from '../../lib/http';
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
  TagValue,
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
 * Datadog APM — trace-only backend over the v2 spans search API.
 *
 *   POST /api/v2/spans/events/search   search spans
 *   GET  /api/v2/services              list APM services
 *
 * Auth needs **two** credentials: an org API key and a personal application
 * key. Datadog's base URL is region-specific (US1/US3/US5/EU1/AP1).
 *
 * Search returns flat spans, not traces, so results are grouped by `trace_id`
 * here. Every search is given an explicit `from`/`to`: without one Datadog
 * applies a short default window, which makes a lookup of an older trace come
 * back empty rather than erroring — a silent wrong answer.
 */

/** Datadog's default search window when the caller gives no bounds. */
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;

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
  if (typeof start === 'number') return Math.floor(start / NS_PER_MS);
  if (/^\d+$/.test(start.trim())) {
    return Math.floor(Number(start) / NS_PER_MS);
  }
  const parsed = Date.parse(start);
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
    );
    return body.data ?? [];
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
    const filter = [
      query.service ? `service:${query.service}` : '',
      query.operation ? `resource_name:${query.operation}` : '',
      query.hasError ? 'status:error' : '',
    ]
      .filter((part) => part.length > 0)
      .join(' ');

    const limit = query.limit ?? 20;
    const events = await this.search(
      filter,
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
    const hydrated = await Promise.all(
      traceIds.map((traceId) => this.getTraceInWindow(traceId, fromMs, toMs)),
    );
    const items = hydrated
      .filter((trace): trace is TraceRecord => trace !== null)
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, limit);
    return { items, totalCount: items.length };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const toMs = Date.now();
    return this.getTraceInWindow(
      traceId,
      toMs - TRACE_LOOKUP_LOOKBACK_MS,
      toMs,
    );
  }

  private async getTraceInWindow(
    traceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<TraceRecord | null> {
    const events = await this.search(`trace_id:${traceId}`, fromMs, toMs, 1000);
    return (
      groupSpans(events).find((trace) => trace.traceId === traceId) ?? null
    );
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

  async serviceMap(lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const toMs = Date.now();
    const traces = await this.searchTraces({
      startTimeUnixMs: toMs - lookbackMinutes * 60 * 1000,
      endTimeUnixMs: toMs,
      limit: Math.max(limit, 20),
    });
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
      detail:
        'The Datadog spans backend serves traces only; metrics use a separate Datadog API',
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
        'The Datadog spans backend serves traces only; logs use a separate Datadog API',
    };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);
    return { trace, metrics: [], logs: [] };
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
    const durationMs = Number.isNaN(endTimeUnixMs)
      ? (attributes.duration ?? 0) / NS_PER_MS
      : Math.max(0, endTimeUnixMs - startTimeUnixMs);
    const isError = attributes.status === 'error';
    const tags: Record<string, TagValue> = {
      ...datadogTags(attributes.tags),
      ...normalizedEntries(attributes.attributes),
      ...Object.fromEntries(
        Object.entries(attributes.custom ?? {}).map(([key, value]) => [
          key,
          normalizeTagValue(value),
        ]),
      ),
    };
    if (attributes.type) tags['datadog.type'] = attributes.type;

    const span: SpanRecord = {
      traceId,
      spanId: attributes.span_id ?? event.id ?? '',
      parentSpanId: attributes.parent_id ?? null,
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

function normalizedEntries(
  values: Record<string, unknown> | undefined,
): Record<string, TagValue> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      normalizeTagValue(value),
    ]),
  );
}

function datadogTags(
  tags: string[] | Record<string, string> | undefined,
): Record<string, TagValue> {
  if (!Array.isArray(tags)) return normalizedEntries(tags);
  return Object.fromEntries(
    tags.map((tag) => {
      const separator = tag.indexOf(':');
      return separator < 0
        ? [tag, true]
        : [tag.slice(0, separator), tag.slice(separator + 1)];
    }),
  );
}
