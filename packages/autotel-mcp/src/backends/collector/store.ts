import { createClient, type Client } from '@libsql/client';
import { SCHEMA_SQL } from './schema';
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
  TagValue,
} from '../../types';
import {
  traceMatchesQuery,
  spanMatchesQuery,
} from '../../modules/query-filters';
import type { Row } from '@libsql/client';
import { asBoolean, asNumber, asString, numberAt } from '../../lib/values';
import { count, flag, json, optionalText, text } from './row';

/** Newest metric points one `listMetrics` call will read into memory. */
const MAX_POINT_ROWS = 50_000;

export interface CollectorStoreOptions {
  maxTraces: number;
  retentionMs: number;
  url?: string; // libsql URL, defaults to file::memory:
}

/**
 * A tag value as SQLite can bind it. Strings and numbers go as they are;
 * SQLite has no boolean type, so a boolean is bound as the 0/1 that
 * `json_each` reads back for JSON true/false.
 */
function bindableTag(value: TagValue): string | number {
  const flag = asBoolean(value);
  if (flag !== undefined) return Number(flag);
  return asString(value) ?? asNumber(value) ?? String(value);
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
      const tid = text(row, 'trace_id');
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
      const trace = await this.getTrace(text(row, 'trace_id'));
      if (trace) records.push(trace);
    }

    return records;
  }

  async listServices(): Promise<ServiceListResult> {
    const result = await this.db.execute(
      'SELECT service_name FROM services ORDER BY last_seen_unix_ms DESC',
    );
    return { services: result.rows.map((r) => text(r, 'service_name')) };
  }

  async listOperations(service: string): Promise<OperationListResult> {
    const result = await this.db.execute({
      sql: `SELECT DISTINCT operation_name FROM spans WHERE service_name = ? ORDER BY operation_name`,
      args: [service],
    });
    return { operations: result.rows.map((r) => text(r, 'operation_name')) };
  }

  async searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const lookbackMinutes = numberAt(query, 'lookbackMinutes');
    const lookbackMs =
      lookbackMinutes === undefined ? undefined : lookbackMinutes * 60 * 1000;

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
      const trace = await this.getTrace(text(row, 'trace_id'));
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
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (query.metricName) {
      conditions.push('metric_name = ?');
      args.push(query.metricName);
    }
    // The caller always asks for a window (the tool defaults to 60 minutes).
    // Ignoring it returns every point still inside the retention period.
    if (query.lookbackMinutes !== undefined) {
      conditions.push('timestamp_unix_ms >= ?');
      args.push(Date.now() - query.lookbackMinutes * 60_000);
    }
    const where =
      conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // A series is one metric name at one attribute set, the same identity
    // `getMetricSeries` uses. Keying by name alone merges `lane=legacy` and
    // `lane=modern` into one series labelled with whichever row came first.
    const countResult = await this.db.execute({
      sql: `SELECT COUNT(*) as cnt FROM (SELECT DISTINCT metric_name, attributes FROM metric_points${where})`,
      args,
    });
    const totalCount = Number(countResult.rows[0]?.cnt ?? 0);

    // ponytail: newest MAX_POINT_ROWS points, grouped in memory. Push the
    // grouping into SQL if a collector ever holds more than a dev workload.
    const result = await this.db.execute({
      sql: `SELECT metric_name, unit, attributes, timestamp_unix_ms, value
            FROM metric_points${where}
            ORDER BY timestamp_unix_ms DESC
            LIMIT ?`,
      args: [...args, MAX_POINT_ROWS + 1],
    });
    const truncated = result.rows.length > MAX_POINT_ROWS;
    const rows = truncated ? result.rows.slice(0, MAX_POINT_ROWS) : result.rows;

    const seriesMap = new Map<string, MetricSeries>();
    for (const row of rows) {
      const name = text(row, 'metric_name');
      const key = `${name}::${text(row, 'attributes') || '{}'}`;
      let series = seriesMap.get(key);
      if (!series) {
        series = {
          metricName: name,
          unit: optionalText(row, 'unit'),
          points: [],
          attributes: json<Record<string, TagValue>>(row, 'attributes', {}),
        };
        seriesMap.set(key, series);
      }
      series.points.push({
        timestampUnixMs: Number(row.timestamp_unix_ms),
        value: Number(row.value),
      });
    }

    let items = [...seriesMap.values()];
    for (const series of items) {
      series.points.sort((a, b) => a.timestampUnixMs - b.timestampUnixMs);
    }
    if (query.serviceName !== undefined) {
      const service = query.serviceName;
      items = items.filter(
        (series) =>
          series.attributes?.['service.name'] === service ||
          series.attributes?.['serviceName'] === service,
      );
    }

    const limit = query.limit ?? 100;
    const searchResult: MetricSearchResult = {
      items: items.slice(0, limit),
      totalCount,
    };
    if (truncated) {
      searchResult.detail = `Point history truncated to the newest ${MAX_POINT_ROWS} points. Narrow metricName or lookbackMinutes for a complete series.`;
    }
    return searchResult;
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
      const attrs = text(row, 'attributes') || '{}';
      const key = `${name}::${attrs}`;
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          metricName: name,
          unit: optionalText(row, 'unit'),
          points: [],
          attributes: json<Record<string, string>>(row, 'attributes', {}),
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
    for (const [key, value] of Object.entries(query.attributes ?? {})) {
      // Attributes live in a JSON text column, so match in SQL rather than
      // post-filtering: LIMIT has to apply after the filter, not before it.
      // json_each takes the key as a bound value, so no JSON-path quoting is
      // involved — `$."a.b"` would need escaping SQLite's path parser does not
      // actually honour. SQLite has no boolean type, so JSON true/false reads
      // back as 1/0.
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(log_records.attributes) WHERE key = ? AND value = ?)',
      );
      args.push(key, bindableTag(value));
    }

    const where =
      conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // Count against the same predicate but without LIMIT. Reporting
    // `items.length` makes totalCount min(total, limit), so a caller cannot
    // tell one matching log from one of four hundred.
    const countResult = await this.db.execute({
      sql: `SELECT COUNT(*) as cnt FROM log_records${where}`,
      args,
    });
    const totalCount = Number(countResult.rows[0]?.cnt ?? 0);

    const result = await this.db.execute({
      sql: `SELECT * FROM log_records${where} ORDER BY timestamp_unix_ms DESC LIMIT ?`,
      args: [...args, query.limit ?? 100],
    });
    const items: LogRecord[] = result.rows.map((r) => ({
      timestampUnixMs: count(r, 'timestamp_unix_ms'),
      severityText: text(r, 'severity_text'),
      body: text(r, 'body'),
      serviceName: optionalText(r, 'service_name'),
      traceId: optionalText(r, 'trace_id'),
      spanId: optionalText(r, 'span_id'),
      attributes: json<Record<string, string>>(r, 'attributes', {}),
    }));

    return { items, totalCount };
  }

  private rowToSpan(row: Row): SpanRecord {
    return {
      traceId: text(row, 'trace_id'),
      spanId: text(row, 'span_id'),
      parentSpanId: optionalText(row, 'parent_span_id') ?? null,
      operationName: text(row, 'operation_name'),
      serviceName: text(row, 'service_name'),
      startTimeUnixMs: count(row, 'start_time_unix_ms'),
      durationMs: count(row, 'duration_ms'),
      // SAFETY: insertSpans writes this column from SpanRecord['statusCode'],
      // which is this union; a row written by anything else renders as
      // whatever status it holds.
      statusCode: text(row, 'status_code') as 'OK' | 'ERROR' | 'UNSET',
      tags: json<Record<string, string>>(row, 'tags', {}),
      hasError: flag(row, 'has_error'),
    };
  }
}
