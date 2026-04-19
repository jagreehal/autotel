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
  TagValue,
  TraceRecord,
  TraceSearchQuery,
  TraceSearchResult,
  TraceSummary,
} from '../../types';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../../modules/query-filters';
import { buildServiceMap } from '../../modules/service-map';
import { summarizeTrace } from '../../modules/trace-summary';
import type { TelemetryBackend } from '../telemetry';

type TempoSearchResponse = {
  traces?: Array<{
    traceID: string;
    rootServiceName?: string;
    rootTraceName?: string;
    startTimeUnixNano?: string;
    durationMs?: number;
  }>;
};

type TempoTagValuesResponse = {
  tagValues?: string[];
};

type OtlpAttribute = {
  key: string;
  value?: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values?: unknown[] };
  };
};

type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OtlpAttribute[];
  status?: { code?: string | number; message?: string };
};

type OtlpScopeSpans = {
  spans?: OtlpSpan[];
};

type OtlpBatch = {
  resource?: { attributes?: OtlpAttribute[] };
  scopeSpans?: OtlpScopeSpans[];
  // Older Tempo versions use `instrumentationLibrarySpans`.
  instrumentationLibrarySpans?: OtlpScopeSpans[];
};

type TempoTraceResponse = {
  batches?: OtlpBatch[];
};

const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
const MAX_FULL_FETCH = 50;

export class TempoBackend implements TelemetryBackend {
  readonly kind = 'tempo' as const;

  constructor(private readonly baseUrl: string) {}

  async healthCheck(): Promise<BackendHealth> {
    try {
      const params = buildTimeRangeParams();
      params.set('q', '{}');
      params.set('limit', '1');
      await jsonGet<TempoSearchResponse>(
        `${this.baseUrl}/api/search?${params}`,
      );
      return { healthy: true, message: 'Tempo reachable' };
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
    // Preferred path: Tempo's tag-values API returns distinct values for a
    // resource attribute without pulling trace payloads.
    try {
      const data = await jsonGet<TempoTagValuesResponse>(
        `${this.baseUrl}/api/search/tag/service.name/values`,
      );
      if (data.tagValues && data.tagValues.length > 0) {
        return { services: [...data.tagValues].sort() };
      }
    } catch {
      // Fall through to search-based fallback.
    }

    const params = buildTimeRangeParams();
    params.set('q', '{}');
    params.set('limit', '1000');
    const data = await jsonGet<TempoSearchResponse>(
      `${this.baseUrl}/api/search?${params}`,
    );
    const services = new Set<string>();
    for (const trace of data.traces ?? []) {
      if (trace.rootServiceName) services.add(trace.rootServiceName);
    }
    return { services: [...services].sort() };
  }

  async listOperations(service: string): Promise<OperationListResult> {
    const params = buildTimeRangeParams();
    params.set('q', `{ resource.service.name = "${escapeTraceql(service)}" }`);
    params.set('limit', '100');
    const data = await jsonGet<TempoSearchResponse>(
      `${this.baseUrl}/api/search?${params}`,
    );
    const operations = new Set<string>();
    for (const trace of data.traces ?? []) {
      if (trace.rootTraceName) operations.add(trace.rootTraceName);
    }
    return { operations: [...operations] };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const clientLimit = query.limit ?? 20;
    // Over-fetch when the caller needs client-side filtering (hasError,
    // statusCode, or generic filters that TraceQL can't express).
    const needsPostFilter =
      query.hasError === true ||
      query.statusCode !== undefined ||
      (query.filters?.length ?? 0) > 0 ||
      query.tags !== undefined;
    const serverLimit = needsPostFilter
      ? Math.min(200, clientLimit * 5)
      : clientLimit;

    const params = buildTimeRangeParams(
      query.startTimeUnixMs,
      query.endTimeUnixMs,
    );
    params.set('q', buildTraceql(query));
    params.set('limit', `${serverLimit}`);

    const searchResult = await jsonGet<TempoSearchResponse>(
      `${this.baseUrl}/api/search?${params}`,
    );
    const headers = searchResult.traces ?? [];

    // Bound full-trace fetches so we don't accidentally hit Tempo with
    // hundreds of parallel requests on broad queries.
    const toFetch = headers.slice(0, MAX_FULL_FETCH);
    const fetchedTraces = await Promise.all(
      toFetch.map(async (header) => {
        try {
          const trace = await this.getTrace(header.traceID);
          return trace;
        } catch {
          return null;
        }
      }),
    );

    const items = fetchedTraces
      .filter((trace): trace is TraceRecord => trace !== null)
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, clientLimit);

    return { items, totalCount: items.length };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    try {
      const data = await jsonGet<TempoTraceResponse>(
        `${this.baseUrl}/api/traces/${encodeURIComponent(traceId)}`,
      );
      return parseOtlpTrace(data, traceId);
    } catch {
      return null;
    }
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    const traceResult = await this.searchTraces(query);
    const spans = traceResult.items.flatMap((trace) => trace.spans);
    // Generic filters were already applied at the trace level; don't
    // re-run them against individual spans.
    const spanQuery = query.filters ? { ...query, filters: undefined } : query;
    const filtered = spans.filter((span) => spanMatchesQuery(span, spanQuery));
    const items = filtered.slice(0, query.limit ?? 50);
    return { items, totalCount: items.length };
  }

  async serviceMap(_lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    // Fan out per-service so quiet services aren't crowded out.
    const { services } = await this.listServices();
    const perServiceLimit = Math.max(limit, 20);
    const results = await Promise.all(
      services.map((svc) =>
        this.searchTraces({ service: svc, limit: perServiceLimit }),
      ),
    );
    const deduped = new Map<string, TraceRecord>();
    for (const result of results) {
      for (const trace of result.items) deduped.set(trace.traceId, trace);
    }
    return buildServiceMap(
      [...deduped.values()],
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
      detail:
        'Tempo does not expose metrics. Pair with a Prometheus-compatible backend for metrics.',
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
        'Tempo does not expose logs. Pair with a Loki-compatible backend for logs.',
    };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);
    return { trace, metrics: [], logs: [] };
  }
}

function buildTimeRangeParams(
  startMs?: number,
  endMs?: number,
): URLSearchParams {
  const end = endMs ?? Date.now();
  const start = startMs ?? end - DEFAULT_LOOKBACK_MS;
  // Tempo's /api/search requires start and end in UNIX seconds.
  const params = new URLSearchParams();
  params.set('start', `${Math.floor(start / 1000)}`);
  params.set('end', `${Math.ceil(end / 1000)}`);
  return params;
}

export function buildTraceql(query: TraceSearchQuery): string {
  const conditions: string[] = [];
  if (query.service) {
    conditions.push(
      `resource.service.name = "${escapeTraceql(query.service)}"`,
    );
  }
  if (query.operation) {
    conditions.push(`name = "${escapeTraceql(query.operation)}"`);
  }
  if (query.hasError === true) {
    conditions.push('status = error');
  }
  if (query.statusCode) {
    conditions.push(`status = ${query.statusCode.toLowerCase()}`);
  }
  if (query.minDurationMs !== undefined) {
    conditions.push(`duration >= ${query.minDurationMs}ms`);
  }
  if (query.maxDurationMs !== undefined) {
    conditions.push(`duration <= ${query.maxDurationMs}ms`);
  }
  if (query.tags) {
    for (const [key, value] of Object.entries(query.tags)) {
      conditions.push(renderTagCondition(key, value));
    }
  }
  if (conditions.length === 0) return '{}';
  return `{ ${conditions.join(' && ')} }`;
}

function renderTagCondition(key: string, value: TagValue): string {
  const field = key.startsWith('resource.') ? key : `span.${key}`;
  if (typeof value === 'string') {
    return `${field} = "${escapeTraceql(value)}"`;
  }
  if (typeof value === 'boolean') {
    return `${field} = ${value ? 'true' : 'false'}`;
  }
  return `${field} = ${value}`;
}

function escapeTraceql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function parseOtlpTrace(
  data: TempoTraceResponse,
  fallbackTraceId: string,
): TraceRecord | null {
  const batches = data.batches ?? [];
  const spans: SpanRecord[] = [];

  for (const batch of batches) {
    const resourceAttrs = parseOtlpAttributes(batch.resource?.attributes);
    const serviceName =
      typeof resourceAttrs['service.name'] === 'string'
        ? resourceAttrs['service.name']
        : 'unknown';

    const scopeSpans =
      batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? [];
    for (const scope of scopeSpans) {
      for (const rawSpan of scope.spans ?? []) {
        const span = parseOtlpSpan(rawSpan, serviceName, fallbackTraceId);
        if (span) spans.push(span);
      }
    }
  }

  if (spans.length === 0) return null;
  return { traceId: fallbackTraceId, spans };
}

function parseOtlpSpan(
  span: OtlpSpan,
  serviceName: string,
  traceIdHint: string,
): SpanRecord | null {
  if (!span.spanId) return null;
  const tags = parseOtlpAttributes(span.attributes);
  const startNs = toNumber(span.startTimeUnixNano) ?? 0;
  const endNs = toNumber(span.endTimeUnixNano) ?? startNs;
  const durationMs = Math.max(0, (endNs - startNs) / 1_000_000);
  const statusCode = resolveOtlpStatus(span.status?.code, tags);

  return {
    traceId: traceIdHint,
    spanId: String(span.spanId),
    parentSpanId: span.parentSpanId ? String(span.parentSpanId) : null,
    operationName: String(span.name ?? 'unknown'),
    serviceName,
    startTimeUnixMs: startNs / 1_000_000,
    durationMs,
    tags,
    hasError:
      statusCode === 'ERROR' ||
      tags['error'] === true ||
      tags['error.kind'] !== undefined,
    statusCode,
  };
}

function parseOtlpAttributes(
  attributes: OtlpAttribute[] | undefined,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  for (const attr of attributes ?? []) {
    if (!attr?.key) continue;
    const value = extractOtlpValue(attr.value);
    if (value !== undefined) out[attr.key] = value;
  }
  return out;
}

function extractOtlpValue(value: OtlpAttribute['value']): TagValue | undefined {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) {
    const parsed =
      typeof value.intValue === 'number'
        ? value.intValue
        : Number(value.intValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.arrayValue) return JSON.stringify(value.arrayValue.values ?? []);
  return undefined;
}

function resolveOtlpStatus(
  code: string | number | undefined,
  tags: Record<string, TagValue>,
): SpanStatusCode {
  if (typeof code === 'number') {
    if (code === 2) return 'ERROR';
    if (code === 1) return 'OK';
  }
  if (typeof code === 'string') {
    const upper = code.toUpperCase();
    if (upper.includes('ERROR')) return 'ERROR';
    if (upper.includes('OK')) return 'OK';
  }
  if (tags['error'] === true || tags['error.kind'] !== undefined) {
    return 'ERROR';
  }
  const httpStatus =
    typeof tags['http.status_code'] === 'number'
      ? tags['http.status_code']
      : typeof tags['http.status_code'] === 'string'
        ? Number(tags['http.status_code'])
        : undefined;
  if (httpStatus !== undefined && Number.isFinite(httpStatus)) {
    if (httpStatus >= 500) return 'ERROR';
    if (httpStatus >= 100) return 'OK';
  }
  return 'UNSET';
}

function toNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
