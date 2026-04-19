import { jsonGet } from '../../lib/http';
import type {
  BackendCapabilities,
  BackendHealth,
  CorrelatedSignals,
  LogSearchQuery,
  LogSearchResult,
  MetricPoint,
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

type PromBuildInfoResponse = {
  status: string;
  data?: { version?: string };
};

type PromLabelValuesResponse = {
  status: string;
  data?: string[];
};

type PromMetadataResponse = {
  status: string;
  data?: Record<string, Array<{ type?: string; help?: string; unit?: string }>>;
};

type PromValueTuple = [number, string];

type PromInstantResult = {
  metric: Record<string, string>;
  value: PromValueTuple;
};

type PromRangeResult = {
  metric: Record<string, string>;
  values: PromValueTuple[];
};

type PromQueryResponse = {
  status: string;
  data?: {
    resultType: string;
    result: PromInstantResult[] | PromRangeResult[];
  };
};

const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;

// OTel → Prometheus default translates dots to underscores, so
// `service.name` becomes `service_name`.
const SERVICE_LABEL = 'service_name';

const UNSUPPORTED_TRACE_DETAIL =
  'Prometheus does not expose traces. Pair with Tempo or Jaeger for trace data.';

const UNSUPPORTED_LOG_DETAIL =
  'Prometheus does not expose logs. Pair with Loki for log data.';

export class PrometheusBackend implements TelemetryBackend {
  readonly kind = 'prometheus' as const;

  constructor(private readonly baseUrl: string) {}

  async healthCheck(): Promise<BackendHealth> {
    try {
      const info = await jsonGet<PromBuildInfoResponse>(
        `${this.baseUrl}/api/v1/status/buildinfo`,
      );
      if (info.status !== 'success') {
        return {
          healthy: false,
          message: `buildinfo status: ${info.status}`,
        };
      }
      return {
        healthy: true,
        message: `Prometheus ${info.data?.version ?? 'unknown'}`,
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
      metrics: 'available',
      logs: 'unsupported',
    };
  }

  async listServices(_query?: ServiceQuery): Promise<ServiceListResult> {
    try {
      const data = await jsonGet<PromLabelValuesResponse>(
        `${this.baseUrl}/api/v1/label/${SERVICE_LABEL}/values`,
      );
      return { services: (data.data ?? []).sort() };
    } catch {
      return { services: [] };
    }
  }

  async listOperations(_service: string): Promise<OperationListResult> {
    // Prometheus has no notion of an "operation" distinct from a metric name.
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

  async listMetrics(query?: MetricSearchQuery): Promise<MetricSearchResult> {
    const limit = query?.limit ?? 100;

    // __name__/values is the authoritative list of metric names; if this
    // fails, Prometheus is unreachable or broken — propagate so runtime
    // probes can detect it. /api/v1/metadata is best-effort (some Prom
    // deployments disable it), so we still swallow its failures.
    const namesRes = await jsonGet<PromLabelValuesResponse>(
      `${this.baseUrl}/api/v1/label/__name__/values`,
    );
    const metaRes = await jsonGet<PromMetadataResponse>(
      `${this.baseUrl}/api/v1/metadata`,
    ).catch(() => ({ data: {} }) as PromMetadataResponse);

    const allNames = namesRes.data ?? [];
    const filtered = query?.metricName
      ? allNames.filter((name) => name.includes(query.metricName!))
      : allNames;

    const metadata = metaRes.data ?? {};
    const items: MetricSeries[] = filtered.slice(0, limit).map((name) => {
      const meta = metadata[name]?.[0];
      const attributes: Record<string, TagValue> = {};
      if (meta?.help) attributes.help = meta.help;
      return {
        metricName: name,
        unit: meta?.unit || undefined,
        points: [],
        attributes,
      };
    });

    return { items, totalCount: items.length };
  }

  async getMetricSeries(
    name: string,
    query?: MetricSeriesQuery,
  ): Promise<MetricSeries[]> {
    const endMs = query?.endTimeUnixMs ?? Date.now();
    const startMs = query?.startTimeUnixMs ?? endMs - DEFAULT_LOOKBACK_MS;
    const rangeSec = Math.max(1, (endMs - startMs) / 1000);
    // Aim for ~60 samples across the window so responses stay compact.
    const step = Math.max(1, Math.round(rangeSec / 60));

    const selector = query?.serviceName
      ? `${escapePromMetric(name)}{${SERVICE_LABEL}="${escapePromLabelValue(
          query.serviceName,
        )}"}`
      : escapePromMetric(name);

    const params = new URLSearchParams({
      query: selector,
      start: `${startMs / 1000}`,
      end: `${endMs / 1000}`,
      step: `${step}s`,
    });

    const data = await jsonGet<PromQueryResponse>(
      `${this.baseUrl}/api/v1/query_range?${params}`,
    );
    if (data.status !== 'success' || !data.data) return [];

    const result = data.data.result as PromRangeResult[];
    const limit = query?.limit ?? 100;

    return result.slice(0, limit).map((series) => {
      const points: MetricPoint[] = (series.values ?? []).map(
        ([ts, value]) => ({
          timestampUnixMs: Math.floor(ts * 1000),
          value: Number(value),
        }),
      );
      const attributes: Record<string, TagValue> = {};
      for (const [key, val] of Object.entries(series.metric ?? {})) {
        if (key !== '__name__') attributes[key] = val;
      }
      return {
        metricName: name,
        points,
        attributes,
      };
    });
  }

  async searchLogs(_query?: LogSearchQuery): Promise<LogSearchResult> {
    return {
      items: [],
      totalCount: 0,
      unsupported: true,
      detail: UNSUPPORTED_LOG_DETAIL,
    };
  }

  async getCorrelatedSignals(_traceId: string): Promise<CorrelatedSignals> {
    return { trace: null, metrics: [], logs: [] };
  }
}

function escapePromMetric(name: string): string {
  // Metric names in PromQL are identifiers — strip anything unsafe.
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function escapePromLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
