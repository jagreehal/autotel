import { createClient, type Client } from '@libsql/client';
import { SCHEMA_SQL } from './schema.js';
import type {
  SpanRecord,
  TraceRecord,
  MetricSeries,
  LogRecord,
  MetricSearchQuery,
  MetricSearchResult,
  MetricSeriesQuery,
  LogSearchQuery,
  LogSearchResult,
  ServiceListResult,
  OperationListResult,
  TraceSearchQuery,
  TraceSearchResult,
  SpanSearchQuery,
  SpanSearchResult,
} from '../../types.js';
import {
  traceMatchesQuery,
  spanMatchesQuery,
} from '../../modules/query-filters.js';

export interface CollectorStoreOptions {
  maxTraces: number;
  retentionMs: number;
  url?: string; // libsql URL, defaults to file::memory:
}

export class CollectorStore {
  private db: Client;
  private opts: CollectorStoreOptions;

  constructor(opts: CollectorStoreOptions) {
    this.opts = opts;
    this.db = createClient({ url: opts.url ?? 'file::memory:' });
  }

  async init(): Promise<void> {
    await this.db.executeMultiple(SCHEMA_SQL);
  }

  async insertSpans(spans: SpanRecord[]): Promise<void> {
    for (const span of spans) {
      await this.db.execute({
        sql: `INSERT OR REPLACE INTO spans
              (trace_id, span_id, parent_span_id, operation_name, service_name,
               start_time_unix_ms, duration_ms, status_code, tags, has_error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          span.traceId,
          span.spanId,
          span.parentSpanId,
          span.operationName,
          span.serviceName,
          span.startTimeUnixMs,
          span.durationMs,
          span.statusCode,
          JSON.stringify(span.tags),
          span.hasError ? 1 : 0,
        ],
      });

      // Upsert service
      await this.db.execute({
        sql: `INSERT OR REPLACE INTO services (service_name, last_seen_unix_ms) VALUES (?, ?)`,
        args: [span.serviceName, span.startTimeUnixMs],
      });
    }

    // Refresh trace aggregates for all affected traces
    const traceIds = [...new Set(spans.map((s) => s.traceId))];
    for (const traceId of traceIds) {
      await this.refreshTraceAggregate(traceId);
    }

    await this.evict();
  }

  private async refreshTraceAggregate(traceId: string): Promise<void> {
    const result = await this.db.execute({
      sql: `SELECT
              MIN(start_time_unix_ms) as start_time,
              MAX(start_time_unix_ms + duration_ms) - MIN(start_time_unix_ms) as duration,
              COUNT(*) as span_count,
              SUM(has_error) as error_count,
              (SELECT service_name FROM spans WHERE trace_id = ? AND parent_span_id IS NULL LIMIT 1) as root_service,
              (SELECT operation_name FROM spans WHERE trace_id = ? AND parent_span_id IS NULL LIMIT 1) as root_operation
            FROM spans WHERE trace_id = ?`,
      args: [traceId, traceId, traceId],
    });

    const row = result.rows[0];
    if (!row) return;

    await this.db.execute({
      sql: `INSERT OR REPLACE INTO traces
            (trace_id, root_service, root_operation, start_time_unix_ms, duration_ms, span_count, error_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        traceId,
        row.root_service,
        row.root_operation,
        row.start_time,
        row.duration,
        row.span_count,
        row.error_count,
      ],
    });
  }

  private async evict(): Promise<void> {
    const countResult = await this.db.execute(
      'SELECT COUNT(*) as cnt FROM traces',
    );
    const count = Number(countResult.rows[0]?.cnt ?? 0);

    if (count <= this.opts.maxTraces) return;

    const excess = count - this.opts.maxTraces;
    const oldTraces = await this.db.execute({
      sql: `SELECT trace_id FROM traces ORDER BY start_time_unix_ms ASC LIMIT ?`,
      args: [excess],
    });

    for (const row of oldTraces.rows) {
      const tid = row.trace_id as string;
      await this.db.execute({
        sql: 'DELETE FROM spans WHERE trace_id = ?',
        args: [tid],
      });
      await this.db.execute({
        sql: 'DELETE FROM traces WHERE trace_id = ?',
        args: [tid],
      });
      await this.db.execute({
        sql: 'DELETE FROM log_records WHERE trace_id = ?',
        args: [tid],
      });
    }
  }

  async getTrace(traceId: string): Promise<TraceRecord | null> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time_unix_ms',
      args: [traceId],
    });
    if (result.rows.length === 0) return null;

    return {
      traceId,
      spans: result.rows.map((r) => this.rowToSpan(r)),
    };
  }

  async getAllTraces(lookbackMinutes?: number): Promise<TraceRecord[]> {
    let sql = 'SELECT DISTINCT trace_id FROM traces';
    const args: (string | number)[] = [];

    if (lookbackMinutes !== undefined) {
      sql += ' WHERE start_time_unix_ms >= ?';
      args.push(Date.now() - lookbackMinutes * 60 * 1000);
    }
    sql += ' ORDER BY start_time_unix_ms DESC';

    const tracesResult = await this.db.execute({ sql, args });
    const records: TraceRecord[] = [];

    for (const row of tracesResult.rows) {
      const trace = await this.getTrace(row.trace_id as string);
      if (trace) records.push(trace);
    }

    return records;
  }

  async listServices(): Promise<ServiceListResult> {
    const result = await this.db.execute(
      'SELECT service_name FROM services ORDER BY last_seen_unix_ms DESC',
    );
    return { services: result.rows.map((r) => r.service_name as string) };
  }

  async listOperations(service: string): Promise<OperationListResult> {
    const result = await this.db.execute({
      sql: `SELECT DISTINCT operation_name FROM spans WHERE service_name = ? ORDER BY operation_name`,
      args: [service],
    });
    return { operations: result.rows.map((r) => r.operation_name as string) };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const lookbackMs =
      'lookbackMinutes' in query &&
      typeof (query as { lookbackMinutes?: number }).lookbackMinutes ===
        'number'
        ? (query as { lookbackMinutes?: number }).lookbackMinutes! * 60 * 1000
        : undefined;

    let sql = 'SELECT DISTINCT trace_id FROM traces';
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (query.startTimeUnixMs !== undefined) {
      conditions.push('start_time_unix_ms >= ?');
      args.push(query.startTimeUnixMs);
    }
    if (lookbackMs !== undefined) {
      conditions.push('start_time_unix_ms >= ?');
      args.push(Date.now() - lookbackMs);
    }
    if (query.endTimeUnixMs !== undefined) {
      conditions.push('start_time_unix_ms <= ?');
      args.push(query.endTimeUnixMs);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY start_time_unix_ms DESC';

    const tracesResult = await this.db.execute({ sql, args });
    const allTraces: TraceRecord[] = [];

    for (const row of tracesResult.rows) {
      const trace = await this.getTrace(row.trace_id as string);
      if (trace) allTraces.push(trace);
    }

    const filtered = allTraces.filter((trace) =>
      traceMatchesQuery(trace, query),
    );
    const limit = query.limit ?? 20;
    const items = filtered.slice(0, limit);
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
    const limit = query.limit ?? 50;
    const items = filtered.slice(0, limit);
    return { items, totalCount: filtered.length };
  }

  async insertMetrics(metrics: MetricSeries[]): Promise<void> {
    for (const series of metrics) {
      for (const point of series.points) {
        await this.db.execute({
          sql: `INSERT INTO metric_points (metric_name, unit, timestamp_unix_ms, value, attributes)
                VALUES (?, ?, ?, ?, ?)`,
          args: [
            series.metricName,
            series.unit ?? null,
            point.timestampUnixMs,
            point.value,
            JSON.stringify(series.attributes ?? {}),
          ],
        });
      }
    }
  }

  async listMetrics(query: MetricSearchQuery): Promise<MetricSearchResult> {
    let sql =
      'SELECT DISTINCT metric_name, unit, attributes FROM metric_points';
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (query.metricName) {
      conditions.push('metric_name = ?');
      args.push(query.metricName);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' LIMIT ?';
    args.push(query.limit ?? 100);

    const result = await this.db.execute({ sql, args });

    const seriesMap = new Map<string, MetricSeries>();
    for (const row of result.rows) {
      const name = row.metric_name as string;
      if (!seriesMap.has(name)) {
        seriesMap.set(name, {
          metricName: name,
          unit: (row.unit as string | null) ?? undefined,
          points: [],
          attributes: JSON.parse((row.attributes as string) || '{}'),
        });
      }
    }

    // Fetch points for each series
    for (const [name, series] of seriesMap) {
      const points = await this.db.execute({
        sql: 'SELECT timestamp_unix_ms, value FROM metric_points WHERE metric_name = ? ORDER BY timestamp_unix_ms',
        args: [name],
      });
      series.points = points.rows.map((r) => ({
        timestampUnixMs: Number(r.timestamp_unix_ms),
        value: Number(r.value),
      }));
    }

    const items = [...seriesMap.values()];
    return { items, totalCount: items.length };
  }

  async getMetricSeries(
    name: string,
    query: MetricSeriesQuery = {},
  ): Promise<MetricSeries[]> {
    let sql =
      'SELECT timestamp_unix_ms, value, unit, attributes FROM metric_points WHERE metric_name = ?';
    const args: (string | number)[] = [name];

    if (query.startTimeUnixMs !== undefined) {
      sql += ' AND timestamp_unix_ms >= ?';
      args.push(query.startTimeUnixMs);
    }
    if (query.endTimeUnixMs !== undefined) {
      sql += ' AND timestamp_unix_ms <= ?';
      args.push(query.endTimeUnixMs);
    }
    sql += ' ORDER BY timestamp_unix_ms ASC';
    if (query.limit !== undefined) {
      sql += ' LIMIT ?';
      args.push(query.limit);
    }

    const result = await this.db.execute({ sql, args });
    if (result.rows.length === 0) return [];

    // Group by attributes to form series
    const seriesMap = new Map<string, MetricSeries>();
    for (const row of result.rows) {
      const attrs = (row.attributes as string) || '{}';
      const key = `${name}::${attrs}`;
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          metricName: name,
          unit: (row.unit as string | null) ?? undefined,
          points: [],
          attributes: JSON.parse(attrs),
        });
      }
      seriesMap.get(key)!.points.push({
        timestampUnixMs: Number(row.timestamp_unix_ms),
        value: Number(row.value),
      });
    }

    let series = [...seriesMap.values()];

    if (query.serviceName !== undefined) {
      const svc = query.serviceName;
      series = series.filter(
        (s) =>
          s.attributes?.['service.name'] === svc ||
          s.attributes?.['serviceName'] === svc,
      );
    }

    return series;
  }

  async insertLogs(logs: LogRecord[]): Promise<void> {
    for (const log of logs) {
      await this.db.execute({
        sql: `INSERT INTO log_records (timestamp_unix_ms, severity_text, body, service_name, trace_id, span_id, attributes)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          log.timestampUnixMs,
          log.severityText,
          log.body,
          log.serviceName ?? null,
          log.traceId ?? null,
          log.spanId ?? null,
          JSON.stringify(log.attributes ?? {}),
        ],
      });
    }
  }

  async searchLogs(query: LogSearchQuery): Promise<LogSearchResult> {
    let sql = 'SELECT * FROM log_records';
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (query.traceId) {
      conditions.push('trace_id = ?');
      args.push(query.traceId);
    }
    if (query.spanId) {
      conditions.push('span_id = ?');
      args.push(query.spanId);
    }
    if (query.serviceName) {
      conditions.push('service_name = ?');
      args.push(query.serviceName);
    }
    if (query.severityText) {
      conditions.push('severity_text = ?');
      args.push(query.severityText);
    }
    if (query.text) {
      conditions.push('body LIKE ?');
      args.push(`%${query.text}%`);
    }
    if (query.startTimeUnixMs !== undefined) {
      conditions.push('timestamp_unix_ms >= ?');
      args.push(query.startTimeUnixMs);
    }
    if (query.endTimeUnixMs !== undefined) {
      conditions.push('timestamp_unix_ms <= ?');
      args.push(query.endTimeUnixMs);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY timestamp_unix_ms DESC LIMIT ?';
    args.push(query.limit ?? 100);

    const result = await this.db.execute({ sql, args });
    const items: LogRecord[] = result.rows.map((r) => ({
      timestampUnixMs: Number(r.timestamp_unix_ms),
      severityText: r.severity_text as string,
      body: r.body as string,
      serviceName: (r.service_name as string | null) ?? undefined,
      traceId: (r.trace_id as string | null) ?? undefined,
      spanId: (r.span_id as string | null) ?? undefined,
      attributes: JSON.parse((r.attributes as string) || '{}'),
    }));

    return { items, totalCount: items.length };
  }

  private rowToSpan(row: Record<string, unknown>): SpanRecord {
    return {
      traceId: row.trace_id as string,
      spanId: row.span_id as string,
      parentSpanId: (row.parent_span_id as string | null) ?? null,
      operationName: row.operation_name as string,
      serviceName: row.service_name as string,
      startTimeUnixMs: Number(row.start_time_unix_ms),
      durationMs: Number(row.duration_ms),
      statusCode: row.status_code as 'OK' | 'ERROR' | 'UNSET',
      tags: JSON.parse((row.tags as string) || '{}'),
      hasError: row.has_error === 1,
    };
  }
}
