import { readFile } from 'node:fs/promises';
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

type FixtureData = {
  traces?: TraceRecord[];
  metrics?: MetricSeries[];
  logs?: LogRecord[];
};

export class FixtureBackend implements TelemetryBackend {
  readonly kind = 'fixture' as const;

  private fixturePromise: Promise<FixtureData> | null = null;

  constructor(private readonly fixturePath: string) {}

  async healthCheck(): Promise<BackendHealth> {
    try {
      const fixture = await this.loadFixture();
      return {
        healthy: true,
        message: `loaded ${fixture.traces?.length ?? 0} traces, ${fixture.metrics?.length ?? 0} metric series, ${fixture.logs?.length ?? 0} logs`,
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

  async listServices(): Promise<ServiceListResult> {
    const traces = await this.loadTraces();
    return {
      services: Array.from(
        new Set(
          traces.flatMap((trace) =>
            trace.spans.map((span) => span.serviceName),
          ),
        ),
      ).sort(),
    };
  }

  async listOperations(serviceName: string): Promise<OperationListResult> {
    const traces = await this.loadTraces();
    const operations = new Set<string>();
    for (const trace of traces) {
      for (const span of trace.spans) {
        if (span.serviceName === serviceName)
          operations.add(span.operationName);
      }
    }
    return { operations: Array.from(operations).sort() };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const traces = await this.loadTraces();
    const filtered = traces.filter((trace) => traceMatchesQuery(trace, query));
    const items = filtered.slice(0, query.limit ?? 20);
    return { items, totalCount: filtered.length };
  }

  async searchSpans(query: SpanSearchQuery): Promise<SpanSearchResult> {
    const traceResult = await this.searchTraces(query);
    const allSpans = traceResult.items.flatMap((trace) => trace.spans);
    // Strip filters — trace-level aggregates were already applied by searchTraces
    const spanQuery = query.filters ? { ...query, filters: undefined } : query;
    const filtered = allSpans.filter((span) =>
      spanMatchesQuery(span, spanQuery),
    );
    const items = filtered.slice(0, query.limit ?? 50);
    return { items, totalCount: filtered.length };
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const traces = await this.loadTraces();
    return traces.find((trace) => trace.traceId === traceId) ?? null;
  }

  async serviceMap(lookbackMinutes = 60, limit = 20): Promise<ServiceMap> {
    const result = await this.searchTraces({
      lookbackMinutes,
      limit,
    } as TraceSearchQuery);
    return buildServiceMap(result.items, limit);
  }

  async summarizeTrace(traceId: string): Promise<TraceSummary | null> {
    const trace = await this.getTrace(traceId);
    return trace ? summarizeTrace(trace) : null;
  }

  async listMetrics(
    query: MetricSearchQuery = {},
  ): Promise<MetricSearchResult> {
    const metrics = await this.loadMetrics();
    const filtered = metrics.filter((series) => {
      if (query.metricName && series.metricName !== query.metricName)
        return false;
      if (
        query.serviceName &&
        series.attributes?.['service.name'] !== query.serviceName &&
        series.attributes?.['serviceName'] !== query.serviceName
      ) {
        return false;
      }
      return true;
    });
    const items = filtered.slice(0, query.limit ?? 20);
    return { items, totalCount: filtered.length };
  }

  async getMetricSeries(
    name: string,
    query: MetricSeriesQuery = {},
  ): Promise<MetricSeries[]> {
    const metrics = await this.loadMetrics();
    return metrics.filter((series) => {
      if (series.metricName !== name) return false;
      if (
        query.serviceName &&
        series.attributes?.['service.name'] !== query.serviceName &&
        series.attributes?.['serviceName'] !== query.serviceName
      ) {
        return false;
      }
      return true;
    });
  }

  async searchLogs(query: LogSearchQuery = {}): Promise<LogSearchResult> {
    const logs = await this.loadLogs();
    const filtered = logs.filter((record) => {
      if (query.serviceName && record.serviceName !== query.serviceName)
        return false;
      if (query.traceId && record.traceId !== query.traceId) return false;
      if (query.spanId && record.spanId !== query.spanId) return false;
      if (query.severityText && record.severityText !== query.severityText)
        return false;
      if (
        query.text &&
        !record.body.toLowerCase().includes(query.text.toLowerCase())
      )
        return false;
      if (
        query.attributes &&
        !matchesAttributes(record.attributes ?? {}, query.attributes)
      )
        return false;
      return true;
    });
    const items = filtered.slice(0, query.limit ?? 50);
    return { items, totalCount: filtered.length };
  }

  async getCorrelatedSignals(traceId: string): Promise<CorrelatedSignals> {
    const trace = await this.getTrace(traceId);

    const involvedServices = trace
      ? Array.from(new Set(trace.spans.map((span) => span.serviceName)))
      : [];

    const [allMetrics, logResult] = await Promise.all([
      this.loadMetrics(),
      this.searchLogs({ traceId }),
    ]);

    const metrics = allMetrics.filter((series) => {
      if (involvedServices.length === 0) return false;
      const svcName =
        series.attributes?.['service.name'] ??
        series.attributes?.['serviceName'];
      return typeof svcName === 'string' && involvedServices.includes(svcName);
    });

    return {
      trace,
      metrics,
      logs: logResult.items,
    };
  }

  private async loadFixture(): Promise<FixtureData> {
    if (!this.fixturePromise) {
      this.fixturePromise = readFile(this.fixturePath, 'utf8').then(
        (raw) => JSON.parse(raw) as FixtureData,
      );
    }
    return this.fixturePromise;
  }

  private async loadTraces(): Promise<TraceRecord[]> {
    const fixture = await this.loadFixture();
    return fixture.traces ?? [];
  }

  private async loadMetrics(): Promise<MetricSeries[]> {
    const fixture = await this.loadFixture();
    return fixture.metrics ?? [];
  }

  private async loadLogs(): Promise<LogRecord[]> {
    const fixture = await this.loadFixture();
    return fixture.logs ?? [];
  }
}

function matchesAttributes(
  actual: Record<string, string | number | boolean>,
  expected: Record<string, string | number | boolean>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => actual[key] === value,
  );
}
