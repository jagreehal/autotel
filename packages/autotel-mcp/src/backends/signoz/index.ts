import { jsonPost } from '../../lib/http';
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
import type { TelemetryBackend } from '../telemetry';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../../modules/query-filters';
import { buildServiceMap } from '../../modules/service-map';
import { summarizeTrace } from '../../modules/trace-summary';
import { normalizeTagValue } from '../span-mapping';
import type { UnknownRecord } from '../../lib/values';
import { asNumber, asRecord, nonEmptyString } from '../../lib/values';

/** SigNoz trace reads over the supported Query Builder v5 API. */

const NS_PER_MS = 1_000_000;
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
const TRACE_LOOKUP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RAW_ROWS = 1000;

interface SignozRawRow {
  timestamp?: string;
  data?: UnknownRecord;
}

interface SignozRawResult {
  queryName?: string;
  rows?: SignozRawRow[];
}

interface SignozQueryRangeResponse {
  type?: string;
  data?: { results?: SignozRawResult[] };
}

interface SignozApiEnvelope {
  data?: SignozQueryRangeResponse;
}

interface SignozSpan {
  traceID?: string;
  spanID?: string;
  parentSpanID?: string;
  name?: string;
  serviceName?: string;
  startTime?: number;
  durationNano?: number;
  statusCode?: number;
  hasError?: boolean;
  attributes?: UnknownRecord;
}

interface SelectField {
  name: string;
  fieldContext?: 'resource' | 'span' | 'attribute';
}

export interface SignozBackendOptions {
  /** Base URL of the SigNoz instance. */
  baseUrl: string;
  /** Cloud API key. Empty for an unauthenticated self-hosted instance. */
  apiKey?: string;
}

/** OTLP numeric status -> the string form the rest of the codebase uses. */
export function toStatusCode(status: number | undefined): SpanStatusCode {
  if (status === 2) return 'ERROR';
  if (status === 1) return 'OK';
  return 'UNSET';
}

function escapeFilterString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
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

  private async queryRows(options: {
    startMs: number;
    endMs: number;
    filter?: string;
    limit: number;
    selectFields?: SelectField[];
  }): Promise<SignozRawRow[]> {
    const body = await jsonPost<SignozApiEnvelope | SignozQueryRangeResponse>(
      new URL('/api/v5/query_range', this.baseUrl).toString(),
      {
        start: options.startMs,
        end: options.endMs,
        requestType: 'raw',
        variables: {},
        compositeQuery: {
          queries: [
            {
              type: 'builder_query',
              spec: {
                name: 'A',
                signal: 'traces',
                filter: { expression: options.filter ?? '' },
                selectFields: options.selectFields ?? [
                  { name: 'service.name', fieldContext: 'resource' },
                ],
                order: [{ key: { name: 'timestamp' }, direction: 'desc' }],
                limit: Math.min(options.limit, MAX_RAW_ROWS),
                offset: 0,
                disabled: false,
              },
            },
          ],
        },
      },
      this.headers(),
    );
    return rawRows(body);
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
    const endMs = Date.now();
    const rows = await this.queryRows({
      startMs: endMs - TRACE_LOOKUP_LOOKBACK_MS,
      endMs,
      limit: MAX_RAW_ROWS,
      selectFields: [{ name: 'service.name', fieldContext: 'resource' }],
    });
    return {
      services: Array.from(
        new Set(
          rows
            .map((row) => readString(row.data, 'serviceName', 'service.name'))
            .filter((name): name is string => Boolean(name)),
        ),
      ),
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
    const endMs = query.endTimeUnixMs ?? Date.now();
    const startMs = query.startTimeUnixMs ?? endMs - DEFAULT_LOOKBACK_MS;
    const limit = query.limit ?? 20;
    const filters: string[] = [];
    if (query.service) {
      filters.push(`service.name = '${escapeFilterString(query.service)}'`);
    }
    if (query.operation) {
      filters.push(`name = '${escapeFilterString(query.operation)}'`);
    }
    if (query.hasError || query.statusCode === 'ERROR') {
      filters.push('has_error = true');
    }

    const rows = await this.queryRows({
      startMs,
      endMs,
      filter: filters.join(' AND '),
      limit: Math.min(limit * 20, MAX_RAW_ROWS),
    });
    const traceIds = Array.from(
      new Set(
        rows
          .map((row) => readString(row.data, 'traceID', 'trace_id'))
          .filter((traceId): traceId is string => Boolean(traceId)),
      ),
    ).slice(0, limit);
    const hydrated = await Promise.all(
      traceIds.map((traceId) => this.getTraceInWindow(traceId, startMs, endMs)),
    );
    const items = hydrated
      .filter((trace): trace is TraceRecord => trace !== null)
      .filter((trace) => traceMatchesQuery(trace, query))
      .slice(0, limit);
    return { items, totalCount: items.length };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const endMs = Date.now();
    return this.getTraceInWindow(
      traceId,
      endMs - TRACE_LOOKUP_LOOKBACK_MS,
      endMs,
    );
  }

  private async getTraceInWindow(
    traceId: string,
    startMs: number,
    endMs: number,
  ): Promise<TraceRecord | null> {
    const rows = await this.queryRows({
      startMs,
      endMs,
      filter: `trace_id = '${escapeFilterString(traceId)}'`,
      limit: MAX_RAW_ROWS,
    });
    const spans = rows
      .map(rowToSignozSpan)
      .filter((span) => span.traceID === traceId)
      .map((span) => toSpanRecord(span, traceId));
    return spans.length > 0 ? { traceId, spans } : null;
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
    // SAFETY: buildServiceMap is the shared builder every backend uses; it
    // returns the same map, described by each backend's own span type.
    return buildServiceMap(traces.items, limit);
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    const trace = await this.getTrace(traceId);
    // SAFETY: as serviceMap above - a shared summariser, one shape.
    return trace ? summarizeTrace(trace) : null;
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

function rawRows(
  body: SignozApiEnvelope | SignozQueryRangeResponse,
): SignozRawRow[] {
  // SAFETY: SigNoz answers either with the envelope (`data.type` present) or
  // with the query-range body directly; the check on the line above is what
  // tells the two apart, and every field read below is optional either way.
  const response =
    body.data && 'type' in body.data
      ? body.data
      : (body as SignozQueryRangeResponse);
  return response.data?.results?.flatMap((result) => result.rows ?? []) ?? [];
}

function readString(
  data: UnknownRecord | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = nonEmptyString(data?.[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readNumber(
  data: UnknownRecord | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = asNumber(data?.[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function groupedAttributes(data: UnknownRecord): UnknownRecord {
  const groups = [
    'attributes',
    'attributes_bool',
    'attributes_float64',
    'attributes_int64',
    'attributes_number',
    'attributes_string',
    'resources_bool',
    'resources_float64',
    'resources_int64',
    'resources_number',
    'resources_string',
  ];
  const merged: UnknownRecord = {};
  for (const key of groups) Object.assign(merged, asRecord(data[key]) ?? {});
  return merged;
}

function rowToSignozSpan(row: SignozRawRow): SignozSpan {
  const data = row.data ?? {};
  const statusCode = readNumber(data, 'statusCode', 'status_code');
  const hasError = data.hasError === true || data.has_error === true;
  const timestampMs = row.timestamp ? Date.parse(row.timestamp) : Number.NaN;
  return {
    traceID: readString(data, 'traceID', 'trace_id'),
    spanID: readString(data, 'spanID', 'span_id'),
    parentSpanID: readString(data, 'parentSpanID', 'parent_span_id'),
    name: readString(data, 'name', 'span_name'),
    serviceName: readString(data, 'serviceName', 'service.name'),
    startTime:
      readNumber(data, 'startTime', 'start_time', 'timestamp') ??
      (Number.isNaN(timestampMs) ? 0 : timestampMs * NS_PER_MS),
    durationNano: readNumber(data, 'durationNano', 'duration_nano'),
    statusCode: statusCode ?? (hasError ? 2 : undefined),
    hasError,
    attributes: groupedAttributes(data),
  };
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
    // SAFETY: normalizeTagValue answers with a TagValue for every entry, so
    // the assembled bag is keyed strings to TagValue; Object.fromEntries
    // cannot carry that.
    tags: Object.fromEntries(
      Object.entries(span.attributes ?? {}).map(([key, value]) => [
        key,
        normalizeTagValue(value),
      ]),
    ) as Record<string, TagValue>,
    hasError: span.hasError === true || statusCode === 'ERROR',
    statusCode,
  };
}
