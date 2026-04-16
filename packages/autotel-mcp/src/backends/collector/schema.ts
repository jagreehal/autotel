export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS spans (
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL PRIMARY KEY,
    parent_span_id TEXT,
    operation_name TEXT NOT NULL,
    service_name TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    duration_ms REAL NOT NULL,
    status_code TEXT NOT NULL DEFAULT 'UNSET',
    tags TEXT NOT NULL DEFAULT '{}',
    has_error INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
  CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service_name);
  CREATE INDEX IF NOT EXISTS idx_spans_start_time ON spans(start_time_unix_ms);

  CREATE TABLE IF NOT EXISTS traces (
    trace_id TEXT PRIMARY KEY,
    root_service TEXT,
    root_operation TEXT,
    start_time_unix_ms INTEGER NOT NULL,
    duration_ms REAL,
    span_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_traces_start_time ON traces(start_time_unix_ms);

  CREATE TABLE IF NOT EXISTS metric_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    unit TEXT,
    timestamp_unix_ms INTEGER NOT NULL,
    value REAL NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_name ON metric_points(metric_name);
  CREATE INDEX IF NOT EXISTS idx_metrics_time ON metric_points(timestamp_unix_ms);

  CREATE TABLE IF NOT EXISTS log_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp_unix_ms INTEGER NOT NULL,
    severity_text TEXT NOT NULL,
    body TEXT NOT NULL,
    service_name TEXT,
    trace_id TEXT,
    span_id TEXT,
    attributes TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_logs_trace ON log_records(trace_id);
  CREATE INDEX IF NOT EXISTS idx_logs_service ON log_records(service_name);
  CREATE INDEX IF NOT EXISTS idx_logs_time ON log_records(timestamp_unix_ms);

  CREATE TABLE IF NOT EXISTS services (
    service_name TEXT PRIMARY KEY,
    last_seen_unix_ms INTEGER NOT NULL
  );
`;
