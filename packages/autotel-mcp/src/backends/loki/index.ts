import { jsonGet } from '../../lib/http';
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
  SpanSearchQuery,
  SpanSearchResult,
  TagValue,
  TraceRecord,
  TraceSearchQuery,
  TraceSearchResult,
  TraceSummary,
} from '../../types';
import type { TelemetryBackend } from '../telemetry';

type LokiLabelResponse = {
  status?: string;
  data?: string[];
};

type LokiStream = {
  stream?: Record<string, string>;
  // Entries are [unix_ns_string, "log line"]
  values?: [string, string][];
};

type LokiQueryResponse = {
  status?: string;
  data?: {
    resultType?: string;
    result?: LokiStream[];
  };
};

const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
const SERVICE_LABEL = 'service_name';

const UNSUPPORTED_TRACE_DETAIL =
  'Loki does not expose traces. Pair with Tempo or Jaeger for trace data.';

const UNSUPPORTED_METRIC_DETAIL =
  'Loki does not expose metrics. Pair with Prometheus for metric data.';

export class LokiBackend implements TelemetryBackend {
  readonly kind = 'loki' as const;

  constructor(private readonly baseUrl: string) {}

  async healthCheck(): Promise<BackendHealth> {
    try {
      const res = await fetch(`${this.baseUrl}/ready`);
      if (res.ok) {
        return { healthy: true, message: 'Loki ready' };
      }
      return {
        healthy: false,
        message: `Loki /ready returned ${res.status}`,
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
      traces: 'unsupported',
      metrics: 'unsupported',
      logs: 'available',
    };
  }

  async listServices(_query?: ServiceQuery): Promise<ServiceListResult> {
    try {
      const data = await jsonGet<LokiLabelResponse>(
        `${this.baseUrl}/loki/api/v1/label/${SERVICE_LABEL}/values`,
      );
      return { services: (data.data ?? []).sort() };
    } catch {
      return { services: [] };
    }
  }

  async listOperations(_service: string): Promise<OperationListResult> {
    return { operations: [] };
  }

  async searchTraces(_query: TraceSearchQuery): Promise<TraceSearchResult> {
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: UNSUPPORTED_TRACE_DETAIL,
    };
  }

  async searchSpans(_query: SpanSearchQuery): Promise<SpanSearchResult> {
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: UNSUPPORTED_TRACE_DETAIL,
    };
  }

  async getTrace(_traceId: string): Promise<TraceRecord | null> {
    return null;
  }

  async serviceMap(
    _lookbackMinutes?: number,
    _limit?: number,
  ): Promise<ServiceMap> {
    return { nodes: [], edges: [] };
  }

  async summarizeTrace(_traceId: string): Promise<TraceSummary | null> {
    return null;
  }

  async listMetrics(_query?: MetricSearchQuery): Promise<MetricSearchResult> {
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: UNSUPPORTED_METRIC_DETAIL,
    };
  }

  async getMetricSeries(
    _name: string,
    _query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    return [];
  }

  async searchLogs(query?: LogSearchQuery): Promise<LogSearchResult> {
    const logQl = buildLogQl(query);
    const endMs = query?.endTimeUnixMs ?? Date.now();
    const startMs = query?.startTimeUnixMs ?? endMs - DEFAULT_LOOKBACK_MS;
    const limit = query?.limit ?? 100;

    // Loki expects timestamps in nanoseconds; ms * 1e6 exceeds
    // Number.MAX_SAFE_INTEGER, so use BigInt to preserve precision.
    const toNanoString = (ms: number): string =>
      (BigInt(Math.floor(ms)) * 1_000_000n).toString();

    const params = new URLSearchParams({
      query: logQl,
      start: toNanoString(startMs),
      end: toNanoString(endMs),
      limit: `${limit}`,
      direction: 'backward',
    });

    const data = await jsonGet<LokiQueryResponse>(
      `${this.baseUrl}/loki/api/v1/query_range?${params}`,
    );

    const streams = data.data?.result ?? [];
    const records: LogRecord[] = [];
    for (const stream of streams) {
      const labels = stream.stream ?? {};
      for (const [tsNanoStr, body] of stream.values ?? []) {
        const tsMs = Math.floor(Number(tsNanoStr) / 1_000_000);
        records.push({
          timestampUnixMs: tsMs,
          severityText:
            (labels['severity_text'] as string | undefined) ??
            (labels['level'] as string | undefined) ??
            '',
          body,
          serviceName:
            (labels[SERVICE_LABEL] as string | undefined) ?? undefined,
          traceId: (labels['trace_id'] as string | undefined) ?? undefined,
          spanId: (labels['span_id'] as string | undefined) ?? undefined,
          attributes: labelsToTags(labels),
        });
      }
    }

    records.sort((a, b) => b.timestampUnixMs - a.timestampUnixMs);
    const trimmed = records.slice(0, limit);
    return { items: trimmed, totalCount: trimmed.length };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const result = await this.searchLogs({ traceId, limit: 100 });
    return { trace: null, metrics: [], logs: result.items };
  }
}

export function buildLogQl(query: LogSearchQuery | undefined): string {
  const labels: string[] = [];
  if (query?.serviceName) {
    labels.push(
      `${SERVICE_LABEL}="${escapeLokiLabelValue(query.serviceName)}"`,
    );
  }
  if (query?.severityText) {
    // Loki streams typically carry `severity_text` or `level`; match either.
    labels.push(`severity_text=~"${escapeLokiLabelValue(query.severityText)}"`);
  }
  if (query?.attributes) {
    for (const [key, value] of Object.entries(query.attributes)) {
      labels.push(`${key}="${escapeLokiLabelValue(String(value))}"`);
    }
  }
  // Loki requires at least one label matcher. If none supplied, use a
  // wide match on the service_name label being present.
  if (labels.length === 0) {
    labels.push(`${SERVICE_LABEL}=~".+"`);
  }
  let logQl = `{${labels.join(',')}}`;

  // Plain-text filter can go after the stream selector.
  if (query?.traceId) {
    logQl += ` |= "${escapeLokiLabelValue(query.traceId)}"`;
  }
  if (query?.spanId) {
    logQl += ` |= "${escapeLokiLabelValue(query.spanId)}"`;
  }
  if (query?.text) {
    logQl += ` |= "${escapeLokiLabelValue(query.text)}"`;
  }
  return logQl;
}

function labelsToTags(
  labels: Record<string, string>,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  for (const [key, value] of Object.entries(labels)) {
    out[key] = value;
  }
  return out;
}

function escapeLokiLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
