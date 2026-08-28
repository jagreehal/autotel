/**
 * Telemetry store, backed by `node:sqlite`.
 *
 * `node:sqlite` is in the standard library on Node 24, which this package
 * already requires — so persistence, indexes and a real query engine cost no
 * dependency at all. The store is what lets the viewer hold more than a
 * screenful of telemetry, survive a restart, and answer a query without
 * shipping every span to the browser first.
 *
 * Layout: `traces` holds one row per trace (the list view reads only this), and
 * `spans` holds the detail. `service` is denormalised onto each span row so a
 * span-level filter (`service = api AND duration > 100`) never needs a join.
 *
 * Concurrency: sqlite serialises writes itself and every method here is
 * synchronous, so there is no interleaving to guard. WAL is enabled so a long
 * read cannot block ingest.
 */

import { DatabaseSync } from 'node:sqlite';
import { compileWhere, type SignalSchema } from '../../query/compile';
import { parse } from '../../query/parse';
import { createHash } from 'node:crypto';
import type { QueryError } from '../../query/ast';
import type { LogData, SpanData, TraceData } from '../types';
import type {
  MetricKind,
  MetricPoint,
  MetricStreamRecord,
  MetricTemporality,
} from '../metric-streams';
import type { SpanAttributes } from '../../widget/types';
import { reduceMetricPoints } from '../metric-reduction';
import { serializeWindow } from '../../widget/timeWindow';

export interface TimeWindow {
  /** Epoch ms, inclusive. */
  start: number;
  /** Epoch ms, inclusive. */
  end: number;
}

export interface DevtoolsStoreOptions {
  /** File path. Omit for an in-memory database (nothing persists). */
  path?: string;
  /** Maximum traces retained; the oldest are pruned past this. */
  maxTraces?: number;
  /**
   * Maximum metric points retained **per series**, not in total.
   *
   * Per-series is the point: a global cap lets one chatty instrument evict
   * every other series, so the quiet metric you were actually watching goes
   * blank while a noisy one fills the buffer.
   */
  maxMetricPoints?: number;
  /** Maximum logs retained; the oldest are pruned past this. */
  maxLogs?: number;
  /** Logical sqlite size cap. Defaults to 512 MiB in memory or 2 GiB on disk. */
  maxBytes?: number;
}

export interface StoreStats {
  bytesUsed: number;
  maxBytes: number;
  traceCount: number;
  spanCount: number;
  logCount: number;
  metricSeriesCount: number;
  metricPointCount: number;
}

/**
 * How far either side of a trace the deep-linked window reaches.
 *
 * A window of exactly the trace's own bounds is a correct answer that reads
 * badly: the trace touches both edges with nothing around it. A minute of air
 * shows what else was happening, and gives a zero-duration trace a window with
 * width at all.
 */
const DEEP_LINK_PAD_MS = 60_000;

/**
 * A link back into the viewer, pointing at a trace and optionally one span.
 *
 * **The window is the part that is easy to leave out and expensive to omit.**
 * A link is read later than it is made, by an agent handing one to a person or
 * a person pasting one into an incident channel, and by then the viewer's
 * default range has rolled past the trace. The telemetry is still there and
 * the view is not looking at it, which reads as "the tool lost my data".
 *
 * Serialized with the widget's own `serializeWindow`, and pinned by a test
 * that parses the result with the widget's own `parseNavHash`, so the two ends
 * cannot drift into agreeing on nothing.
 */
function traceDeepLink(
  traceId: string,
  bounds: { start_time: number | bigint; end_time: number | bigint },
  spanId?: string,
): string {
  const params = new URLSearchParams({ tab: 'traces', trace: traceId });
  if (spanId) params.set('span', spanId);
  params.set(
    'window',
    serializeWindow({
      type: 'custom',
      start: Number(bounds.start_time) - DEEP_LINK_PAD_MS,
      end: Number(bounds.end_time) + DEEP_LINK_PAD_MS,
    }) ?? '',
  );
  return `/#${params.toString()}`;
}

export interface TraceProjection {
  traceId: string;
  serviceName: string;
  durationMs: number;
  statusCode: 'OK' | 'ERROR' | 'UNSET';
  spanCount: number;
  errorSpanCount: number;
  serviceCount: number;
  llmSpanCount: number;
  totalTokens: number;
  modelsUsed: string[];
  topOperations: Array<{ operation: string; count: number }>;
  slowestSpans: Array<{
    spanId: string;
    name: string;
    service: string;
    durationMs: number;
    /** Selects this span, not just the trace containing it. */
    deepLink: string;
  }>;
  deepLink: string;
}

export interface QueryTracesArgs {
  query: string;
  window?: TimeWindow;
  limit?: number;
  /** Opaque keyset cursor from a previous page's `nextCursor`. */
  cursor?: string;
}

export interface QueryTracesResult {
  traces: TraceData[];
  /** Cursor for the next page, or null when this is the last one. */
  nextCursor: string | null;
  /** Present only when the query text failed to parse. */
  errors?: QueryError[];
}

/**
 * Shape of the schema this build knows how to read.
 *
 * Bump it whenever a change to the DDL cannot be reached by the migrations in
 * this file. A `--db` file written by a newer build is refused rather than
 * queried, because the alternative is an opaque "no such column" thrown from
 * whichever query happens to run first.
 *
 * `0` means a file written before this guard existed. Those are adopted and
 * stamped, since the migrations above already cover every shape they can be in.
 */
const SCHEMA_VERSION = 1;

const DEFAULT_MAX_TRACES = 100_000;
const DEFAULT_MAX_METRIC_POINTS = 5_000;
const DEFAULT_MAX_LOGS = 100_000;
const DEFAULT_LIMIT = 100;
const MAX_QUERY_PAGE_SIZE = 1_000;
/**
 * Spans scanned per side of a comparison.
 *
 * A cohort is a statistical population, not a page: the fractions are only as
 * honest as the sample, so this is deliberately far larger than a list page.
 */
const COHORT_ROW_LIMIT = 20_000;

/** One chart line, with the points to draw it. */
export interface MetricSeries {
  seriesId: string;
  name: string;
  unit?: string;
  description?: string;
  kind: MetricKind;
  temporality?: MetricTemporality;
  monotonic?: boolean;
  service: string;
  scope?: { name: string; version?: string };
  /** Full resource identity (host, pod, process, deployment, and service). */
  resource: SpanAttributes;
  /** The attributes that distinguish this series from its siblings. */
  attributes: SpanAttributes;
  points: MetricPoint[];
}

/** A row in the metric catalogue. */
export interface MetricCatalogEntry {
  name: string;
  kind: MetricKind;
  unit?: string;
  description?: string;
  seriesCount: number;
}

export interface QueryMetricSeriesArgs {
  name: string;
  window?: TimeWindow;
  /** Maximum points returned per series after server-side reduction. */
  maxPoints?: number;
}

export interface QueryLogsArgs {
  query: string;
  window?: TimeWindow;
  limit?: number;
  cursor?: string;
}

export interface QueryLogsResult {
  logs: LogData[];
  nextCursor: string | null;
  errors?: QueryError[];
}

/**
 * Query vocabulary for logs.
 *
 * `severity` and `severity_number` are both exposed deliberately: the text is
 * what people read, but "error and above" is a numeric comparison and string
 * ordering cannot express it. Anything not named here is a log attribute.
 */
export const LOG_SCHEMA: SignalSchema = {
  columns: {
    service: { column: 'service', type: 'string' },
    severity: { column: 'severity_text', type: 'string' },
    severity_number: { column: 'severity_number', type: 'number' },
    trace_id: { column: 'trace_id', type: 'string' },
    span_id: { column: 'span_id', type: 'string' },
    body: { column: 'body_text', type: 'string' },
  },
  attributesColumn: 'attributes',
  // `body_text` is the serialized body — which is what the row displays, so it
  // is what a free-text search must match against.
  freeTextColumns: ['body', 'service', 'severity', 'trace_id'],
  attributeIndex: {
    table: 'attribute_occurrences',
    signal: 'logs',
    entitySql: 'id',
  },
};

/**
 * Query vocabulary for spans.
 *
 * Anything not named here is treated as a span attribute, so every attribute a
 * service emits is queryable without being declared.
 */
/**
 * Ties a child row to the span row being filtered.
 *
 * `s` is the alias `queryTraces` gives the spans table, the same coupling
 * `attributeIndex.entitySql` already carries: these are trusted SQL fragments
 * that must stay in step with the FROM clause the store writes. The event and
 * link tests fail if the alias moves, which is what keeps them in step.
 */
const SPAN_ROW_JOIN = 'rel.trace_id = s.trace_id AND rel.span_id = s.span_id';

export const SPAN_SCHEMA: SignalSchema = {
  columns: {
    service: { column: 'service', type: 'string' },
    name: { column: 'name', type: 'string' },
    kind: { column: 'kind', type: 'string' },
    duration: { column: 'duration', type: 'number' },
    status: { column: 'status_code', type: 'string' },
    trace_id: { column: 'trace_id', type: 'string' },
    span_id: { column: 'span_id', type: 'string' },
    parent_span_id: { column: 'parent_span_id', type: 'string' },
  },
  attributesColumn: 'attributes',
  freeTextColumns: ['name', 'service', 'trace_id'],
  attributeIndex: {
    table: 'attribute_occurrences',
    signal: 'traces',
    entitySql: "(trace_id || ':' || span_id)",
  },
  related: {
    'event.name': {
      table: 'span_events',
      column: 'name',
      joinSql: SPAN_ROW_JOIN,
    },
    'link.trace_id': {
      table: 'span_links',
      column: 'linked_trace_id',
      joinSql: SPAN_ROW_JOIN,
    },
    'link.span_id': {
      table: 'span_links',
      column: 'linked_span_id',
      joinSql: SPAN_ROW_JOIN,
    },
  },
};

const METRIC_SCHEMA: SignalSchema = {
  columns: {
    name: { column: 'name', type: 'string' },
    kind: { column: 'kind', type: 'string' },
    unit: { column: 'unit', type: 'string' },
    description: { column: 'description', type: 'string' },
    service: { column: 'service', type: 'string' },
  },
  attributesColumn: 'resource',
  freeTextColumns: ['name', 'description', 'unit', 'service'],
};

const SPANS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS spans (
  span_id        TEXT NOT NULL,
  trace_id       TEXT NOT NULL,
  parent_span_id TEXT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  service        TEXT,
  start_time     INTEGER NOT NULL,
  end_time       INTEGER NOT NULL,
  duration       INTEGER NOT NULL,
  status_code    TEXT NOT NULL,
  status_message TEXT,
  attributes     TEXT NOT NULL DEFAULT '{}',
  events         TEXT,
  links          TEXT,
  scope          TEXT,
  PRIMARY KEY (trace_id, span_id)
);
`;

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS traces (
  trace_id       TEXT PRIMARY KEY,
  correlation_id TEXT,
  service        TEXT,
  root_span_id   TEXT,
  start_time     INTEGER NOT NULL,
  end_time       INTEGER NOT NULL,
  duration       INTEGER NOT NULL,
  status         TEXT NOT NULL,
  partial        INTEGER NOT NULL DEFAULT 0
);

${SPANS_TABLE_DDL}

CREATE TABLE IF NOT EXISTS metric_series (
  series_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  unit          TEXT,
  description   TEXT,
  kind          TEXT NOT NULL,
  temporality   TEXT,
  monotonic     INTEGER,
  service       TEXT NOT NULL,
  scope_name    TEXT,
  scope_version TEXT,
  resource      TEXT NOT NULL DEFAULT '{}',
  attributes    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS metric_points (
  series_id       TEXT NOT NULL,
  timestamp       INTEGER NOT NULL,
  start_timestamp INTEGER,
  value           REAL,
  count           REAL,
  sum             REAL,
  min             REAL,
  max             REAL,
  bucket_counts   TEXT,
  explicit_bounds TEXT,
  exp_scale       INTEGER,
  zero_count      REAL,
  zero_threshold  REAL,
  positive_buckets TEXT,
  negative_buckets TEXT,
  quantiles       TEXT,
  exemplars       TEXT,
  PRIMARY KEY (series_id, timestamp)
);

CREATE TABLE IF NOT EXISTS logs (
  id              TEXT PRIMARY KEY,
  timestamp       INTEGER NOT NULL,
  service         TEXT,
  severity_text   TEXT,
  severity_number INTEGER,
  trace_id        TEXT,
  span_id         TEXT,
  -- The body as displayed: what free-text search matches against.
  body_text       TEXT NOT NULL DEFAULT '',
  -- The body as sent. Structured bodies must survive as structure; a JSON body
  -- flattened to text is a log nobody can read.
  body_json       TEXT,
  attributes      TEXT NOT NULL DEFAULT '{}',
  resource        TEXT
);

CREATE TABLE IF NOT EXISTS attribute_values (
  signal     TEXT NOT NULL,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  value_text TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (signal, key, value_json)
);

-- Span events and links, normalized so they can be filtered.
--
-- The JSON on the span row stays: it is the payload the waterfall renders, and
-- these two tables are the query index over it, the same split that
-- attribute_occurrences already makes against the attributes blob. Both are
-- written and deleted with their span, and backfilled on open for a --db
-- file written before they existed.
CREATE TABLE IF NOT EXISTS span_events (
  trace_id  TEXT NOT NULL,
  span_id   TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  name      TEXT NOT NULL,
  timestamp INTEGER,
  PRIMARY KEY (trace_id, span_id, idx)
);

CREATE TABLE IF NOT EXISTS span_links (
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL,
  idx             INTEGER NOT NULL,
  linked_trace_id TEXT NOT NULL,
  linked_span_id  TEXT NOT NULL,
  PRIMARY KEY (trace_id, span_id, idx)
);

CREATE TABLE IF NOT EXISTS attribute_occurrences (
  signal     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (signal, entity_id, key)
);

CREATE INDEX IF NOT EXISTS idx_traces_start   ON traces(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_time      ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace     ON logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_logs_severity  ON logs(severity_number, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_series_name    ON metric_series(name);
CREATE INDEX IF NOT EXISTS idx_points_time    ON metric_points(series_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_spans_trace    ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_start    ON spans(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_service  ON spans(service, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_duration ON spans(duration DESC);
CREATE INDEX IF NOT EXISTS idx_attribute_value ON attribute_values(signal, value_text, key);
CREATE INDEX IF NOT EXISTS idx_attribute_equality ON attribute_occurrences(signal, key, value_json, entity_id);
CREATE INDEX IF NOT EXISTS idx_span_events_name ON span_events(name);
CREATE INDEX IF NOT EXISTS idx_span_links_target ON span_links(linked_trace_id);
`;

export class DevtoolsStore {
  private readonly db: DatabaseSync;
  private readonly maxTraces: number;
  private readonly maxMetricPoints: number;
  private readonly maxLogs: number;
  private readonly maxBytes: number;

  constructor(options: DevtoolsStoreOptions = {}) {
    this.db = new DatabaseSync(options.path ?? ':memory:');
    this.maxTraces = options.maxTraces ?? DEFAULT_MAX_TRACES;
    this.maxMetricPoints = options.maxMetricPoints ?? DEFAULT_MAX_METRIC_POINTS;
    this.maxLogs = options.maxLogs ?? DEFAULT_MAX_LOGS;
    this.maxBytes =
      options.maxBytes ?? (options.path ? 2 * 1024 ** 3 : 512 * 1024 ** 2);
    this.guardSchemaVersion(options.path);
    this.migrateSpanIdentity();
    this.db.exec(DDL);
    this.migrateMetricFidelity();
    this.backfillAttributeDictionary();
    this.backfillSpanChildren();
    this.registerRegexp();
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  /** Refuse a file this build cannot read, before any query touches it. */
  private guardSchemaVersion(path: string | undefined): void {
    const found = pragmaNumber(this.db, 'user_version');
    if (found === 0 || found === SCHEMA_VERSION) return;
    this.db.close();
    throw new Error(
      `${path ?? ':memory:'} was written by a different autotel-devtools schema ` +
        `(found version ${found}, this build reads ${SCHEMA_VERSION}). ` +
        `Point --db at another file, or delete this one to start fresh.`,
    );
  }

  /** Upgrade databases created before span identity included the trace id. */
  private migrateSpanIdentity(): void {
    const table = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spans'",
      )
      .get();
    if (!table) return;

    const columns = this.db
      .prepare('PRAGMA table_info(spans)')
      .all() as unknown as Array<{
      name: string;
      pk: number | bigint;
    }>;
    const primaryKey = columns
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => column.name);
    if (primaryKey.join(',') === 'trace_id,span_id') return;

    this.db.exec('BEGIN');
    try {
      this.db.exec('ALTER TABLE spans RENAME TO spans_legacy_span_id_pk');
      this.db.exec(SPANS_TABLE_DDL);
      this.db.exec(`
        INSERT INTO spans (span_id, trace_id, parent_span_id, name, kind, service,
                           start_time, end_time, duration, status_code,
                           status_message, attributes, events, links, scope)
        SELECT span_id, trace_id, parent_span_id, name, kind, service,
               start_time, end_time, duration, status_code,
               status_message, attributes, events, links, scope
        FROM spans_legacy_span_id_pk
      `);
      this.db.exec('DROP TABLE spans_legacy_span_id_pk');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Add lossless metric fields to databases created by earlier releases. */
  private migrateMetricFidelity(): void {
    const hadResource = this.hasColumn('metric_series', 'resource');
    this.addColumnIfMissing(
      'metric_series',
      'resource',
      "TEXT NOT NULL DEFAULT '{}'",
    );
    this.addColumnIfMissing('metric_points', 'exp_scale', 'INTEGER');
    this.addColumnIfMissing('metric_points', 'zero_count', 'REAL');
    this.addColumnIfMissing('metric_points', 'zero_threshold', 'REAL');
    this.addColumnIfMissing('metric_points', 'positive_buckets', 'TEXT');
    this.addColumnIfMissing('metric_points', 'negative_buckets', 'TEXT');
    if (!hadResource) this.migrateLegacyMetricSeriesIdentity();
  }

  private hasColumn(
    table: 'metric_series' | 'metric_points',
    column: string,
  ): boolean {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as unknown as Array<{
      name: string;
    }>;
    return columns.some((item) => item.name === column);
  }

  private addColumnIfMissing(
    table: 'metric_series' | 'metric_points',
    column: string,
    declaration: string,
  ): void {
    if (this.hasColumn(table, column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }

  private migrateLegacyMetricSeriesIdentity(): void {
    const rows = this.db
      .prepare('SELECT * FROM metric_series')
      .all() as unknown as SeriesRow[];
    if (rows.length === 0) return;
    const updatePoints = this.db.prepare(
      'UPDATE metric_points SET series_id = ? WHERE series_id = ?',
    );
    const updateSeries = this.db.prepare(
      'UPDATE metric_series SET series_id = ?, resource = ? WHERE series_id = ?',
    );

    this.db.exec('BEGIN');
    try {
      for (const row of rows) {
        const resource: SpanAttributes = { 'service.name': row.service };
        const stream = {
          name: row.name,
          unit: row.unit ?? undefined,
          kind: row.kind as MetricKind,
          temporality: (row.temporality as MetricTemporality) ?? undefined,
          monotonic: row.monotonic === null ? undefined : row.monotonic === 1,
          service: row.service,
          scope: row.scope_name
            ? { name: row.scope_name, version: row.scope_version ?? undefined }
            : undefined,
          resource,
          points: [],
        } satisfies MetricStreamRecord;
        const nextId = seriesIdentity(
          stream,
          parseJson<SpanAttributes>(row.attributes) ?? {},
        );
        updatePoints.run(nextId, row.series_id);
        updateSeries.run(nextId, stableJson(resource), row.series_id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * SQLite parses `REGEXP` but ships no implementation — using it without
   * registering one is a runtime error, not a syntax error. The language offers
   * regex matching, so the function has to exist.
   *
   * An invalid pattern matches nothing rather than throwing: the user is
   * probably mid-typing, and a thrown error would blank the whole result list.
   */
  private registerRegexp(): void {
    this.db.function('regexp', (pattern: unknown, value: unknown) => {
      if (value == null) return 0;
      try {
        return new RegExp(String(pattern)).test(String(value)) ? 1 : 0;
      } catch {
        return 0;
      }
    });
  }

  ingestTraces(traces: TraceData[]): void {
    if (traces.length === 0) return;

    const upsertTrace = this.db.prepare(`
      INSERT INTO traces (trace_id, correlation_id, service, root_span_id,
                          start_time, end_time, duration, status, partial)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trace_id) DO UPDATE SET
        -- A trace grows as spans arrive: widen the bounds rather than replacing
        -- them, so a late span cannot shrink the trace it belongs to.
        start_time = min(start_time, excluded.start_time),
        end_time   = max(end_time,   excluded.end_time),
        duration   = max(end_time,   excluded.end_time) - min(start_time, excluded.start_time),
        status     = CASE WHEN excluded.status = 'ERROR' THEN 'ERROR' ELSE status END,
        service    = COALESCE(excluded.service, service),
        root_span_id = CASE
          WHEN traces.partial = 1 AND excluded.partial = 0
            THEN COALESCE(excluded.root_span_id, root_span_id)
          ELSE COALESCE(root_span_id, excluded.root_span_id)
        END,
        -- Once the true root has arrived, a delayed partial replay cannot make
        -- the stored trace provisional again.
        partial    = min(partial, excluded.partial)
    `);

    const upsertSpan = this.db.prepare(`
      INSERT INTO spans (span_id, trace_id, parent_span_id, name, kind, service,
                         start_time, end_time, duration, status_code,
                         status_message, attributes, events, links, scope)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trace_id, span_id) DO UPDATE SET
        name           = excluded.name,
        end_time       = excluded.end_time,
        duration       = excluded.duration,
        status_code    = excluded.status_code,
        status_message = excluded.status_message,
        attributes     = excluded.attributes,
        events         = excluded.events,
        links          = excluded.links
    `);
    const upsertAttribute = this.attributeUpsert();
    const upsertOccurrence = this.attributeOccurrenceUpsert();
    const clearOccurrences = this.db.prepare(
      "DELETE FROM attribute_occurrences WHERE signal = 'traces' AND entity_id = ?",
    );

    // Re-ingesting a span replaces its events and links rather than adding to
    // them: a span arriving twice is the same span, not twice the events.
    const clearEvents = this.db.prepare(
      'DELETE FROM span_events WHERE trace_id = ? AND span_id = ?',
    );
    const clearLinks = this.db.prepare(
      'DELETE FROM span_links WHERE trace_id = ? AND span_id = ?',
    );
    const insertEvent = this.db.prepare(
      'INSERT INTO span_events (trace_id, span_id, idx, name, timestamp) VALUES (?, ?, ?, ?, ?)',
    );
    const insertLink = this.db.prepare(
      'INSERT INTO span_links (trace_id, span_id, idx, linked_trace_id, linked_span_id) VALUES (?, ?, ?, ?, ?)',
    );

    this.db.exec('BEGIN');
    try {
      for (const trace of traces) {
        upsertTrace.run(
          trace.traceId,
          trace.correlationId ?? null,
          trace.service ?? null,
          trace.rootSpan?.spanId ?? null,
          trace.startTime,
          trace.endTime,
          trace.duration,
          trace.status,
          trace.partial ? 1 : 0,
        );

        for (const span of trace.spans ?? []) {
          upsertSpan.run(
            span.spanId,
            span.traceId,
            span.parentSpanId ?? null,
            span.name,
            span.kind,
            spanService(span, trace.service),
            span.startTime,
            span.endTime,
            span.duration,
            span.status?.code ?? 'UNSET',
            span.status?.message ?? null,
            JSON.stringify(span.attributes ?? {}),
            span.events?.length ? JSON.stringify(span.events) : null,
            span.links?.length ? JSON.stringify(span.links) : null,
            span.scope ? JSON.stringify(span.scope) : null,
          );
          const entityId = `${span.traceId}:${span.spanId}`;
          clearOccurrences.run(entityId);
          this.indexAttributes(
            upsertAttribute,
            upsertOccurrence,
            'traces',
            entityId,
            span.attributes ?? {},
            span.startTime,
          );

          clearEvents.run(span.traceId, span.spanId);
          span.events?.forEach((event, index) => {
            insertEvent.run(
              span.traceId,
              span.spanId,
              index,
              event.name,
              event.timestamp ?? null,
            );
          });
          clearLinks.run(span.traceId, span.spanId);
          span.links?.forEach((link, index) => {
            insertLink.run(
              span.traceId,
              span.spanId,
              index,
              link.traceId,
              link.spanId,
            );
          });
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Find traces matching a query.
   *
   * The filter runs against *spans* and the results are traces: a trace matches
   * when any of its spans does. That is what makes `http.status_code = 500`
   * useful — the attribute is on one span, but the thing you want to open is
   * the trace containing it.
   */
  queryTraces(args: QueryTracesArgs): QueryTracesResult {
    const parsed = parse(args.query ?? '');
    if (!parsed.ok) {
      return { traces: [], nextCursor: null, errors: parsed.errors };
    }

    const { sql: whereSql, params } = compileWhere(parsed.node, SPAN_SCHEMA);
    const limit = Math.min(
      MAX_QUERY_PAGE_SIZE,
      Math.max(1, args.limit ?? DEFAULT_LIMIT),
    );

    const clauses = [`s.trace_id = t.trace_id`, whereSql];
    const queryParams: unknown[] = [...params];

    if (args.window) {
      clauses.push('t.start_time >= ? AND t.start_time <= ?');
      queryParams.push(args.window.start, args.window.end);
    }

    const cursor = decodeCursor(args.cursor);
    if (cursor) {
      // Keyset pagination: strictly older than the last row, with trace_id
      // breaking ties so two traces sharing a millisecond can't hide each other.
      clauses.push(
        '(t.start_time < ? OR (t.start_time = ? AND t.trace_id < ?))',
      );
      queryParams.push(cursor.startTime, cursor.startTime, cursor.traceId);
    }

    // `EXISTS` rather than a join + DISTINCT: a trace appears once however many
    // of its spans match, and sqlite can stop at the first matching span.
    const rows = this.db
      .prepare(
        `SELECT t.* FROM traces t
         WHERE EXISTS (SELECT 1 FROM spans s WHERE ${clauses.join(' AND ')})
         ORDER BY t.start_time DESC, t.trace_id DESC
         LIMIT ?`,
      )
      .all(...(queryParams as never[]), limit + 1) as unknown as TraceRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      traces: this.hydrateTracePage(page),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              startTime: Number(last.start_time),
              traceId: last.trace_id,
            })
          : null,
    };
  }

  ingestLogs(logs: LogData[]): void {
    if (logs.length === 0) return;

    const upsert = this.db.prepare(`
      INSERT INTO logs (id, timestamp, service, severity_text, severity_number,
                        trace_id, span_id, body_text, body_json, attributes,
                        resource)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const upsertAttribute = this.attributeUpsert();
    const upsertOccurrence = this.attributeOccurrenceUpsert();

    this.db.exec('BEGIN');
    try {
      for (const log of logs) {
        const structured = typeof log.body === 'object' && log.body !== null;
        const inserted = upsert.run(
          log.id,
          log.timestamp,
          log.resourceName ?? null,
          log.severityText ?? null,
          log.severityNumber ?? null,
          log.traceId ?? null,
          log.spanId ?? null,
          structured ? JSON.stringify(log.body) : String(log.body ?? ''),
          structured ? JSON.stringify(log.body) : null,
          JSON.stringify(log.attributes ?? {}),
          log.resource ? JSON.stringify(log.resource) : null,
        );
        if (Number(inserted.changes) === 0) continue;
        this.indexAttributes(
          upsertAttribute,
          upsertOccurrence,
          'logs',
          log.id,
          log.attributes ?? {},
          log.timestamp,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  queryLogs(args: QueryLogsArgs): QueryLogsResult {
    const parsed = parse(args.query ?? '');
    if (!parsed.ok)
      return { logs: [], nextCursor: null, errors: parsed.errors };

    const { sql: whereSql, params } = compileWhere(parsed.node, LOG_SCHEMA);
    const limit = Math.min(
      MAX_QUERY_PAGE_SIZE,
      Math.max(1, args.limit ?? DEFAULT_LIMIT),
    );

    const clauses = [whereSql];
    const queryParams: unknown[] = [...params];

    if (args.window) {
      clauses.push('timestamp >= ? AND timestamp <= ?');
      queryParams.push(args.window.start, args.window.end);
    }

    const cursor = decodeCursor(args.cursor);
    if (cursor) {
      // Keyset pagination, with the id breaking ties so two logs sharing a
      // millisecond cannot hide each other.
      clauses.push('(timestamp < ? OR (timestamp = ? AND id < ?))');
      queryParams.push(cursor.startTime, cursor.startTime, cursor.traceId);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM logs
         WHERE ${clauses.join(' AND ')}
         ORDER BY timestamp DESC, id DESC
         LIMIT ?`,
      )
      .all(...(queryParams as never[]), limit + 1) as unknown as LogRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      logs: page.map(hydrateLog),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              startTime: Number(last.timestamp),
              traceId: last.id,
            })
          : null,
    };
  }

  countLogs(): number {
    const row = this.db.prepare('SELECT count(*) AS n FROM logs').get() as {
      n: number | bigint;
    };
    return Number(row.n);
  }

  /**
   * Store metric points, grouped into series.
   *
   * One series is one chart line: `(name, kind, unit, service, scope, point
   * attributes)`. Both directions of getting this wrong are bad — too coarse
   * and every line collapses into one meaningless average, too fine and one
   * logical series sprouts a new line on every export — so the identity is a
   * content hash over exactly those fields, with attribute keys sorted so an
   * exporter's key ordering cannot split a series in two.
   */
  ingestMetrics(streams: MetricStreamRecord[]): void {
    if (streams.length === 0) return;

    const upsertSeries = this.db.prepare(`
      INSERT INTO metric_series (series_id, name, unit, description, kind,
                                 temporality, monotonic, service, scope_name,
                                 scope_version, resource, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_id) DO UPDATE SET
        -- Description and unit can be filled in by a later export; the identity
        -- fields cannot change without producing a different series_id.
        description = COALESCE(excluded.description, description),
        unit        = COALESCE(excluded.unit, unit),
        temporality = COALESCE(excluded.temporality, temporality)
    `);

    const upsertPoint = this.db.prepare(`
      INSERT INTO metric_points (series_id, timestamp, start_timestamp, value,
                                 count, sum, min, max, bucket_counts,
                                 explicit_bounds, exp_scale, zero_count,
                                 zero_threshold, positive_buckets,
                                 negative_buckets, quantiles, exemplars)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_id, timestamp) DO UPDATE SET
        value           = excluded.value,
        count           = excluded.count,
        sum             = excluded.sum,
        min             = excluded.min,
        max             = excluded.max,
        bucket_counts   = excluded.bucket_counts,
        explicit_bounds = excluded.explicit_bounds,
        exp_scale       = excluded.exp_scale,
        zero_count      = excluded.zero_count,
        zero_threshold  = excluded.zero_threshold,
        positive_buckets = excluded.positive_buckets,
        negative_buckets = excluded.negative_buckets,
        quantiles       = excluded.quantiles,
        exemplars       = excluded.exemplars
    `);

    this.db.exec('BEGIN');
    try {
      for (const stream of streams) {
        for (const point of stream.points) {
          const seriesId = seriesIdentity(stream, point.attributes);
          upsertSeries.run(
            seriesId,
            stream.name,
            stream.unit ?? null,
            stream.description ?? null,
            stream.kind,
            stream.temporality ?? null,
            stream.monotonic === undefined ? null : stream.monotonic ? 1 : 0,
            stream.service,
            stream.scope?.name ?? null,
            stream.scope?.version ?? null,
            stableJson(stream.resource),
            stableJson(point.attributes),
          );
          upsertPoint.run(
            seriesId,
            point.timestamp,
            point.startTimestamp ?? null,
            point.value ?? null,
            point.count ?? null,
            point.sum ?? null,
            point.min ?? null,
            point.max ?? null,
            point.bucketCounts ? JSON.stringify(point.bucketCounts) : null,
            point.explicitBounds ? JSON.stringify(point.explicitBounds) : null,
            point.scale ?? null,
            point.zeroCount ?? null,
            point.zeroThreshold ?? null,
            point.positive ? JSON.stringify(point.positive) : null,
            point.negative ? JSON.stringify(point.negative) : null,
            point.quantiles ? JSON.stringify(point.quantiles) : null,
            point.exemplars ? JSON.stringify(point.exemplars) : null,
          );
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Every metric name held, for the catalogue the Metrics tab lists. */
  listMetricNames(): MetricCatalogEntry[] {
    return this.queryMetricCatalog('').metrics;
  }

  queryMetricCatalog(query: string): {
    metrics: MetricCatalogEntry[];
    errors?: QueryError[];
  } {
    const parsed = parse(query);
    if (!parsed.ok) return { metrics: [], errors: parsed.errors };
    const compiled = compileWhere(parsed.node, METRIC_SCHEMA);
    const rows = this.db
      .prepare(
        `SELECT name, kind, unit, description, count(*) AS series_count
         FROM metric_series
         WHERE ${compiled.sql}
         GROUP BY name, kind
         ORDER BY name ASC`,
      )
      .all(...(compiled.params as never[])) as unknown as Array<{
      name: string;
      kind: string;
      unit: string | null;
      description: string | null;
      series_count: number | bigint;
    }>;

    return {
      metrics: rows.map((row) => ({
        name: row.name,
        kind: row.kind as MetricKind,
        unit: row.unit ?? undefined,
        description: row.description ?? undefined,
        seriesCount: Number(row.series_count),
      })),
    };
  }

  /**
   * The series for one metric, with their points.
   *
   * A series whose points all fall outside the window is omitted rather than
   * returned empty: an empty line in the legend claims data exists where none
   * does, and the caller cannot tell the two apart.
   */
  queryMetricSeries(args: QueryMetricSeriesArgs): MetricSeries[] {
    const seriesRows = this.db
      .prepare(
        'SELECT * FROM metric_series WHERE name = ? ORDER BY series_id ASC',
      )
      .all(args.name) as unknown as SeriesRow[];

    const pointsSql = args.window
      ? `SELECT * FROM metric_points
         WHERE series_id = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`
      : `SELECT * FROM metric_points WHERE series_id = ? ORDER BY timestamp ASC`;
    const pointsStmt = this.db.prepare(pointsSql);

    const out: MetricSeries[] = [];
    for (const row of seriesRows) {
      const pointRows = (args.window
        ? pointsStmt.all(row.series_id, args.window.start, args.window.end)
        : pointsStmt.all(row.series_id)) as unknown as PointRow[];
      if (pointRows.length === 0) continue;

      out.push({
        seriesId: row.series_id,
        name: row.name,
        unit: row.unit ?? undefined,
        description: row.description ?? undefined,
        kind: row.kind as MetricKind,
        temporality: (row.temporality as MetricTemporality) ?? undefined,
        monotonic: row.monotonic === null ? undefined : row.monotonic === 1,
        service: row.service,
        scope: row.scope_name
          ? { name: row.scope_name, version: row.scope_version ?? undefined }
          : undefined,
        resource: parseJson<SpanAttributes>(row.resource) ?? {},
        attributes: parseJson<SpanAttributes>(row.attributes) ?? {},
        points: reduceMetricPoints(
          pointRows.map(hydratePoint),
          row.kind as MetricKind,
          Math.max(4, Math.min(args.maxPoints ?? 2_000, 20_000)),
          {
            temporality: (row.temporality as MetricTemporality) ?? undefined,
          },
        ),
      });
    }
    return out;
  }

  getTrace(traceId: string): TraceData | null {
    const row = this.db
      .prepare('SELECT * FROM traces WHERE trace_id = ?')
      .get(traceId) as unknown as TraceRow | undefined;
    return row ? this.hydrateTrace(row) : null;
  }

  describeTrace(traceId: string): TraceProjection | null {
    const trace = this.db
      .prepare('SELECT * FROM traces WHERE trace_id = ?')
      .get(traceId) as unknown as TraceRow | undefined;
    if (!trace) return null;
    const spans = this.db
      .prepare(
        `
      SELECT span_id, name, service, duration, status_code, attributes
      FROM spans WHERE trace_id = ? ORDER BY duration DESC
    `,
      )
      .all(traceId) as unknown as Array<{
      span_id: string;
      name: string;
      service: string | null;
      duration: number | bigint;
      status_code: string;
      attributes: string;
    }>;
    const operations = new Map<string, number>();
    const services = new Set<string>();
    const models = new Set<string>();
    let errors = 0;
    let llmSpans = 0;
    let totalTokens = 0;
    for (const span of spans) {
      operations.set(span.name, (operations.get(span.name) ?? 0) + 1);
      services.add(span.service ?? 'unknown');
      if (span.status_code === 'ERROR') errors++;
      const attributes =
        parseJson<Record<string, unknown>>(span.attributes) ?? {};
      const model =
        attributes['gen_ai.response.model'] ??
        attributes['gen_ai.request.model'];
      if (typeof model === 'string') {
        models.add(model);
        llmSpans++;
      }
      const tokens =
        attributes['gen_ai.usage.total_tokens'] ??
        Number(attributes['gen_ai.usage.input_tokens'] ?? 0) +
          Number(attributes['gen_ai.usage.output_tokens'] ?? 0);
      totalTokens += Number(tokens) || 0;
    }
    return {
      traceId,
      serviceName: trace.service ?? 'unknown',
      durationMs: Number(trace.duration),
      statusCode: trace.status as TraceProjection['statusCode'],
      spanCount: spans.length,
      errorSpanCount: errors,
      serviceCount: services.size,
      llmSpanCount: llmSpans,
      totalTokens,
      modelsUsed: [...models].sort(),
      topOperations: [...operations]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([operation, count]) => ({ operation, count })),
      slowestSpans: spans.slice(0, 5).map((span) => ({
        spanId: span.span_id,
        name: span.name,
        service: span.service ?? 'unknown',
        durationMs: Number(span.duration),
        deepLink: traceDeepLink(traceId, trace, span.span_id),
      })),
      deepLink: traceDeepLink(traceId, trace),
    };
  }

  findSlowest(limit = 10): TraceProjection[] {
    const rows = this.db
      .prepare('SELECT trace_id FROM traces ORDER BY duration DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 100))) as unknown as Array<{
      trace_id: string;
    }>;
    return rows.flatMap((row) => {
      const projection = this.describeTrace(row.trace_id);
      return projection ? [projection] : [];
    });
  }

  countSpans(): number {
    const row = this.db.prepare('SELECT count(*) AS n FROM spans').get() as {
      n: number | bigint;
    };
    return Number(row.n);
  }

  countTraces(): number {
    const row = this.db.prepare('SELECT count(*) AS n FROM traces').get() as {
      n: number | bigint;
    };
    return Number(row.n);
  }

  /**
   * One row per matching span, for a cohort comparison.
   *
   * Attributes plus the first-class columns, because "the slow ones are all
   * `service=payments`" is exactly the shape of answer wanted and `service` is
   * a column rather than an attribute. Ids are left out: they take a distinct
   * value per span, so they can never describe a group, and including them
   * only gives the ranking noise to wade through.
   *
   * Throws on a query that does not parse. Returning an empty cohort instead
   * would surface as "no difference found", which is a different and much
   * more misleading answer than "your query is wrong".
   */
  cohortRows(args: QueryTracesArgs): Array<Record<string, unknown>> {
    const parsed = parse(args.query ?? '');
    if (!parsed.ok) {
      throw new Error(
        `Cohort query did not parse: ${parsed.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const { sql: whereSql, params } = compileWhere(parsed.node, SPAN_SCHEMA);
    const clauses = [whereSql];
    const queryParams = [...params];
    if (args.window) {
      clauses.push('s.start_time >= ? AND s.start_time <= ?');
      queryParams.push(args.window.start, args.window.end);
    }

    const rows = this.db
      .prepare(
        `SELECT s.service, s.name, s.kind, s.duration, s.status_code, s.attributes
         FROM spans s
         WHERE ${clauses.join(' AND ')}
         ORDER BY s.start_time DESC
         LIMIT ?`,
      )
      .all(
        ...(queryParams as never[]),
        Math.min(args.limit ?? COHORT_ROW_LIMIT, COHORT_ROW_LIMIT),
      ) as unknown as Array<{
      service: string | null;
      name: string;
      kind: string;
      duration: number | bigint;
      status_code: string;
      attributes: string;
    }>;

    return rows.map((row) => ({
      ...(parseJson<Record<string, unknown>>(row.attributes) ?? {}),
      service: row.service ?? 'unknown',
      name: row.name,
      kind: row.kind,
      status: row.status_code,
    }));
  }

  /**
   * What the store has actually seen, for the coverage join.
   *
   * Both routes in are counted: the `http.route` attribute a framework
   * integration sets, and the span name, which is what `trace('name', fn)`
   * produces and is all a non-HTTP entry point ever has. Counting is cheap
   * here because `attribute_values` already carries per-value totals.
   */
  observedSpans(): {
    routeCounts: Record<string, number>;
    spanNameCounts: Record<string, number>;
  } {
    const routeRows = this.db
      .prepare(
        `SELECT value_text AS value, seen_count AS count FROM attribute_values
         WHERE signal = 'traces' AND key = 'http.route'`,
      )
      .all() as unknown as Array<{ value: string; count: number | bigint }>;

    const nameRows = this.db
      .prepare('SELECT name, count(*) AS count FROM spans GROUP BY name')
      .all() as unknown as Array<{ name: string; count: number | bigint }>;

    return {
      routeCounts: Object.fromEntries(
        routeRows.map((row) => [row.value, Number(row.count)]),
      ),
      spanNameCounts: Object.fromEntries(
        nameRows.map((row) => [row.name, Number(row.count)]),
      ),
    };
  }

  /** Query fields currently present, for editor completion. */
  listQueryFields(signal: 'traces' | 'logs', limit = 200): string[] {
    const schema = signal === 'traces' ? SPAN_SCHEMA : LOG_SCHEMA;
    const table = signal === 'traces' ? 'spans' : 'logs';
    const rows = this.db
      .prepare(
        `SELECT DISTINCT json_each.key AS key
         FROM ${table}, json_each(${table}.attributes)
         WHERE json_valid(${table}.attributes)
         ORDER BY key ASC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 500))) as unknown as Array<{
      key: string;
    }>;
    return [
      ...new Set([
        ...Object.keys(schema.columns),
        ...rows.map((row) => row.key),
      ]),
    ];
  }

  /**
   * Values of one attribute paired with another on the same entity.
   *
   * `searchAttributes` matches on value text, which cannot answer "what arms
   * does this experiment have". Pairing two keys across the same span can, and
   * that is what turns a pair of cohorts into something the viewer offers
   * rather than something the reader has to type.
   *
   * Rows arrive grouped by `key`, each group's values commonest first, so a
   * caller can build the groups in one pass and take the two commonest as a
   * default pair.
   *
   * The join runs over `attribute_occurrences`, not the `attribute_values`
   * dictionary: occurrences are deleted with their span, so retention prunes
   * them, and they carry the entity a value was seen on, so an arm is only
   * offered for the experiment it actually ran under. The dictionary can do
   * neither — it counts values for the lifetime of the database and forgets
   * which span each came from, which would offer arms belonging to a different
   * experiment and experiments whose spans are long gone.
   */
  pairedAttributeValues(
    signal: 'traces' | 'logs',
    key: string,
    pairedKey: string,
    limit = 200,
  ): Array<{ value: unknown; paired: unknown; count: number }> {
    const rows = this.db
      .prepare(
        `
      SELECT a.value_json AS value_json, b.value_json AS paired_json, count(*) AS count
      FROM attribute_occurrences a
      JOIN attribute_occurrences b
        ON b.signal = a.signal AND b.entity_id = a.entity_id AND b.key = ?
      WHERE a.signal = ? AND a.key = ?
      GROUP BY a.value_json, b.value_json
      ORDER BY value_json ASC, count DESC, paired_json ASC
      LIMIT ?
    `,
      )
      .all(
        pairedKey,
        signal,
        key,
        Math.max(1, Math.min(limit, 500)),
      ) as unknown as Array<{
      value_json: string;
      paired_json: string;
      count: number | bigint;
    }>;
    return rows.map((row) => ({
      value: JSON.parse(row.value_json) as unknown,
      paired: JSON.parse(row.paired_json) as unknown,
      count: Number(row.count),
    }));
  }

  searchAttributes(
    signal: 'traces' | 'logs',
    value: string,
    limit = 50,
  ): Array<{ key: string; value: unknown; count: number }> {
    const rows = this.db
      .prepare(
        `
      SELECT key, value_json, seen_count
      FROM attribute_values
      WHERE signal = ? AND value_text LIKE ? ESCAPE '\\'
      ORDER BY seen_count DESC, key ASC
      LIMIT ?
    `,
      )
      .all(
        signal,
        `%${escapeLike(value)}%`,
        Math.max(1, Math.min(limit, 200)),
      ) as unknown as Array<{
      key: string;
      value_json: string;
      seen_count: number | bigint;
    }>;
    return rows.map((row) => ({
      key: row.key,
      value: parseJson<unknown>(row.value_json),
      count: Number(row.seen_count),
    }));
  }

  private attributeUpsert() {
    return this.db.prepare(`
      INSERT INTO attribute_values (signal, key, value_json, value_text, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(signal, key, value_json) DO UPDATE SET
        seen_count = seen_count + 1,
        last_seen = max(last_seen, excluded.last_seen)
    `);
  }

  private attributeOccurrenceUpsert() {
    return this.db.prepare(`
      INSERT INTO attribute_occurrences(signal, entity_id, key, value_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(signal, entity_id, key) DO UPDATE SET value_json = excluded.value_json
    `);
  }

  private indexAttributes(
    statement: ReturnType<DatabaseSync['prepare']>,
    occurrence: ReturnType<DatabaseSync['prepare']>,
    signal: 'traces' | 'logs',
    entityId: string,
    attributes: SpanAttributes,
    timestamp: number,
  ): void {
    for (const [key, value] of Object.entries(attributes)) {
      const encoded = JSON.stringify(value);
      statement.run(signal, key, encoded, String(value), timestamp);
      occurrence.run(signal, entityId, key, encoded);
    }
  }

  /**
   * Index the events and links already sitting in the span JSON.
   *
   * A `--db` file written before these tables existed holds spans whose events
   * no query can reach. Reading them out of the JSON on open is what makes
   * `event.name = …` work against telemetry captured yesterday. Keyed on the
   * table being empty while spans exist, so it runs once rather than on every
   * open.
   */
  private backfillSpanChildren(): void {
    const pending = this.db
      .prepare(
        `SELECT (SELECT count(*) FROM spans WHERE events IS NOT NULL OR links IS NOT NULL) AS carriers,
                (SELECT count(*) FROM span_events) AS events,
                (SELECT count(*) FROM span_links) AS links`,
      )
      .get() as {
      carriers: number | bigint;
      events: number | bigint;
      links: number | bigint;
    };
    if (Number(pending.carriers) === 0) return;
    if (Number(pending.events) > 0 || Number(pending.links) > 0) return;

    this.db.exec(`
      INSERT OR IGNORE INTO span_events(trace_id, span_id, idx, name, timestamp)
      SELECT spans.trace_id, spans.span_id, json_each.key,
             json_extract(json_each.value, '$.name'),
             json_extract(json_each.value, '$.timestamp')
      FROM spans, json_each(spans.events)
      WHERE spans.events IS NOT NULL AND json_valid(spans.events)
        AND json_extract(json_each.value, '$.name') IS NOT NULL;
      INSERT OR IGNORE INTO span_links(trace_id, span_id, idx, linked_trace_id, linked_span_id)
      SELECT spans.trace_id, spans.span_id, json_each.key,
             json_extract(json_each.value, '$.traceId'),
             json_extract(json_each.value, '$.spanId')
      FROM spans, json_each(spans.links)
      WHERE spans.links IS NOT NULL AND json_valid(spans.links)
        AND json_extract(json_each.value, '$.traceId') IS NOT NULL;
    `);
  }

  private backfillAttributeDictionary(): void {
    const row = this.db
      .prepare('SELECT count(*) AS n FROM attribute_values')
      .get() as { n: number | bigint };
    if (Number(row.n) === 0)
      this.db.exec(`
      INSERT OR IGNORE INTO attribute_values(signal, key, value_json, value_text, seen_count, last_seen)
      SELECT 'traces', json_each.key, json_quote(json_each.value), CAST(json_each.value AS TEXT), count(*), max(spans.start_time)
      FROM spans, json_each(spans.attributes) GROUP BY json_each.key, json_quote(json_each.value);
      INSERT OR IGNORE INTO attribute_values(signal, key, value_json, value_text, seen_count, last_seen)
      SELECT 'logs', json_each.key, json_quote(json_each.value), CAST(json_each.value AS TEXT), count(*), max(logs.timestamp)
      FROM logs, json_each(logs.attributes) GROUP BY json_each.key, json_quote(json_each.value);
    `);
    const occurrences = this.db
      .prepare('SELECT count(*) AS n FROM attribute_occurrences')
      .get() as { n: number | bigint };
    if (Number(occurrences.n) === 0)
      this.db.exec(`
      INSERT OR IGNORE INTO attribute_occurrences(signal, entity_id, key, value_json)
      SELECT 'traces', spans.trace_id || ':' || spans.span_id, json_each.key, json_quote(json_each.value)
      FROM spans, json_each(spans.attributes);
      INSERT OR IGNORE INTO attribute_occurrences(signal, entity_id, key, value_json)
      SELECT 'logs', logs.id, json_each.key, json_quote(json_each.value)
      FROM logs, json_each(logs.attributes);
    `);
  }

  /**
   * Prune the oldest traces past the row cap, and their spans with them.
   *
   * Spans are deleted in the same transaction as their traces: a pruned trace
   * that left its spans behind would leave rows that no query can reach and no
   * later sweep would find, since every sweep starts from `traces`.
   */
  enforceRetention(): void {
    this.enforceMetricRetention();
    this.enforceLogRetention();
    if (this.maxTraces <= 0) {
      this.enforceByteRetention();
      return;
    }
    const total = this.countTraces();
    if (total <= this.maxTraces) {
      this.enforceByteRetention();
      return;
    }

    const excess = total - this.maxTraces;
    this.db.exec('BEGIN');
    try {
      const doomed = this.db
        .prepare(
          `SELECT trace_id FROM traces
           ORDER BY start_time ASC, trace_id ASC
           LIMIT ?`,
        )
        .all(excess) as unknown as Array<{ trace_id: string }>;

      const deleteSpans = this.db.prepare(
        'DELETE FROM spans WHERE trace_id = ?',
      );
      const deleteTrace = this.db.prepare(
        'DELETE FROM traces WHERE trace_id = ?',
      );
      for (const { trace_id } of doomed) {
        deleteSpans.run(trace_id);
        deleteTrace.run(trace_id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.removeOrphanedAttributes();
    this.enforceByteRetention();
  }

  getStats(): StoreStats {
    const pageCount = pragmaNumber(this.db, 'page_count');
    const freePages = pragmaNumber(this.db, 'freelist_count');
    const pageSize = pragmaNumber(this.db, 'page_size');
    const metric = this.db
      .prepare(
        'SELECT count(DISTINCT series_id) AS series, count(*) AS points FROM metric_points',
      )
      .get() as { series: number | bigint; points: number | bigint };
    return {
      bytesUsed: Math.max(0, pageCount - freePages) * pageSize,
      maxBytes: this.maxBytes,
      traceCount: this.countTraces(),
      spanCount: this.countSpans(),
      logCount: this.countLogs(),
      metricSeriesCount: Number(metric.series),
      metricPointCount: Number(metric.points),
    };
  }

  private enforceByteRetention(): void {
    if (this.maxBytes <= 0) return;
    for (
      let pass = 0;
      pass < 100 && this.getStats().bytesUsed > this.maxBytes;
      pass++
    ) {
      const before = this.getStats();
      if (before.traceCount + before.logCount + before.metricPointCount === 0)
        break;
      this.db.exec('BEGIN');
      try {
        const traceBatch = Math.max(1, Math.ceil(before.traceCount * 0.05));
        this.db
          .prepare(
            `DELETE FROM spans WHERE trace_id IN (
          SELECT trace_id FROM traces ORDER BY start_time ASC LIMIT ?
        )`,
          )
          .run(traceBatch);
        this.db
          .prepare(
            `DELETE FROM traces WHERE trace_id IN (
          SELECT trace_id FROM traces ORDER BY start_time ASC LIMIT ?
        )`,
          )
          .run(traceBatch);
        this.db
          .prepare(
            `DELETE FROM logs WHERE id IN (
          SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?
        )`,
          )
          .run(Math.max(1, Math.ceil(before.logCount * 0.05)));
        this.db
          .prepare(
            `DELETE FROM metric_points WHERE rowid IN (
          SELECT rowid FROM metric_points ORDER BY timestamp ASC LIMIT ?
        )`,
          )
          .run(Math.max(1, Math.ceil(before.metricPointCount * 0.05)));
        this.db.exec(`DELETE FROM metric_series WHERE series_id NOT IN (
          SELECT DISTINCT series_id FROM metric_points
        )`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      this.removeOrphanedAttributes();
    }
  }

  /**
   * Trim each series to its newest `maxMetricPoints`.
   *
   * Per series, not globally: a global cap would let one chatty instrument
   * evict every other series, blanking the quiet chart someone was watching.
   */
  private enforceMetricRetention(): void {
    if (this.maxMetricPoints <= 0) return;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `DELETE FROM metric_points
           WHERE rowid IN (
             SELECT rowid FROM (
               SELECT rowid,
                      row_number() OVER (
                        PARTITION BY series_id ORDER BY timestamp DESC
                      ) AS rn
               FROM metric_points
             ) WHERE rn > ?
           )`,
        )
        .run(this.maxMetricPoints);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Trim the log table to its newest `maxLogs` rows. */
  private enforceLogRetention(): void {
    if (this.maxLogs <= 0) return;
    const total = this.countLogs();
    if (total <= this.maxLogs) return;

    this.db
      .prepare(
        `DELETE FROM logs WHERE id IN (
           SELECT id FROM logs ORDER BY timestamp ASC, id ASC LIMIT ?
         )`,
      )
      .run(total - this.maxLogs);
    this.removeOrphanedAttributes();
  }

  private removeOrphanedAttributes(): void {
    this.db.exec(`
      DELETE FROM attribute_occurrences
      WHERE signal = 'logs' AND entity_id NOT IN (SELECT id FROM logs);
      DELETE FROM attribute_occurrences
      WHERE signal = 'traces' AND entity_id NOT IN (
        SELECT trace_id || ':' || span_id FROM spans
      );
      DELETE FROM span_events WHERE trace_id || ':' || span_id NOT IN (
        SELECT trace_id || ':' || span_id FROM spans
      );
      DELETE FROM span_links WHERE trace_id || ':' || span_id NOT IN (
        SELECT trace_id || ':' || span_id FROM spans
      );
    `);
  }

  clear(): void {
    this.db.exec(
      'DELETE FROM spans; DELETE FROM traces; DELETE FROM logs; DELETE FROM metric_points; DELETE FROM metric_series; DELETE FROM attribute_values; DELETE FROM attribute_occurrences; DELETE FROM span_events; DELETE FROM span_links;',
    );
  }

  clearSignal(signal: 'traces' | 'logs' | 'metrics'): void {
    if (signal === 'traces') {
      this.db.exec(
        "DELETE FROM spans; DELETE FROM traces; DELETE FROM attribute_values WHERE signal = 'traces'; DELETE FROM attribute_occurrences WHERE signal = 'traces'; DELETE FROM span_events; DELETE FROM span_links;",
      );
    } else if (signal === 'logs') {
      this.db.exec(
        "DELETE FROM logs; DELETE FROM attribute_values WHERE signal = 'logs'; DELETE FROM attribute_occurrences WHERE signal = 'logs';",
      );
    } else {
      this.db.exec('DELETE FROM metric_points; DELETE FROM metric_series;');
    }
  }

  deleteMetric(name: string): number {
    const ids = this.db
      .prepare('SELECT series_id FROM metric_series WHERE name = ?')
      .all(name) as unknown as Array<{ series_id: string }>;
    const removePoints = this.db.prepare(
      'DELETE FROM metric_points WHERE series_id = ?',
    );
    this.db.exec('BEGIN');
    try {
      for (const { series_id: id } of ids) removePoints.run(id);
      this.db.prepare('DELETE FROM metric_series WHERE name = ?').run(name);
      this.db.exec('COMMIT');
      return ids.length;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  deleteTraces(traceIds: string[]): number {
    const ids = [...new Set(traceIds)].slice(0, 1_000);
    const removeSpans = this.db.prepare('DELETE FROM spans WHERE trace_id = ?');
    const removeTrace = this.db.prepare(
      'DELETE FROM traces WHERE trace_id = ?',
    );
    let deleted = 0;
    this.db.exec('BEGIN');
    try {
      for (const id of ids) {
        removeSpans.run(id);
        deleted += Number(removeTrace.run(id).changes);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.removeOrphanedAttributes();
    return deleted;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed — closing twice is not worth surfacing to a caller
      // that is, by definition, shutting down.
    }
  }

  /**
   * Hydrate a page of traces with one span query rather than one per trace.
   *
   * A list of 100 traces was 101 statements: the page, then a `SELECT` per
   * trace. Grouping in memory costs the same rows and one round of planning.
   * Ordering is `trace_id, start_time` so each group arrives already in the
   * order a waterfall draws it, which is what the list-hydration test pins.
   */
  private hydrateTracePage(rows: TraceRow[]): TraceData[] {
    if (rows.length === 0) return [];

    const placeholders = rows.map(() => '?').join(', ');
    const spanRows = this.db
      .prepare(
        `SELECT * FROM spans WHERE trace_id IN (${placeholders})
         ORDER BY trace_id ASC, start_time ASC`,
      )
      .all(
        ...(rows.map((row) => row.trace_id) as never[]),
      ) as unknown as SpanRow[];

    const byTrace = new Map<string, SpanData[]>();
    for (const spanRow of spanRows) {
      const list = byTrace.get(spanRow.trace_id);
      if (list) list.push(hydrateSpan(spanRow));
      else byTrace.set(spanRow.trace_id, [hydrateSpan(spanRow)]);
    }

    return rows.map((row) =>
      this.assembleTrace(row, byTrace.get(row.trace_id) ?? []),
    );
  }

  private hydrateTrace(row: TraceRow): TraceData {
    const spanRows = this.db
      .prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC')
      .all(row.trace_id) as unknown as SpanRow[];

    return this.assembleTrace(row, spanRows.map(hydrateSpan));
  }

  /** The row-to-trace mapping, shared by the single and batched paths. */
  private assembleTrace(row: TraceRow, spans: SpanData[]): TraceData {
    return {
      traceId: row.trace_id,
      correlationId: row.correlation_id ?? row.trace_id,
      service: row.service ?? 'unknown',
      spans,
      rootSpan: spans.find((s) => s.spanId === row.root_span_id) ?? spans[0],
      startTime: Number(row.start_time),
      endTime: Number(row.end_time),
      duration: Number(row.duration),
      status: row.status as TraceData['status'],
      partial: row.partial === 1,
    };
  }
}

interface TraceRow {
  trace_id: string;
  correlation_id: string | null;
  service: string | null;
  root_span_id: string | null;
  start_time: number | bigint;
  end_time: number | bigint;
  duration: number | bigint;
  status: string;
  partial: number;
}

interface LogRow {
  id: string;
  timestamp: number | bigint;
  service: string | null;
  severity_text: string | null;
  severity_number: number | null;
  trace_id: string | null;
  span_id: string | null;
  body_text: string;
  body_json: string | null;
  attributes: string;
  resource: string | null;
}

interface SeriesRow {
  series_id: string;
  name: string;
  unit: string | null;
  description: string | null;
  kind: string;
  temporality: string | null;
  monotonic: number | null;
  service: string;
  scope_name: string | null;
  scope_version: string | null;
  resource: string;
  attributes: string;
}

interface PointRow {
  series_id: string;
  timestamp: number | bigint;
  start_timestamp: number | bigint | null;
  value: number | null;
  count: number | null;
  sum: number | null;
  min: number | null;
  max: number | null;
  bucket_counts: string | null;
  explicit_bounds: string | null;
  exp_scale: number | null;
  zero_count: number | null;
  zero_threshold: number | null;
  positive_buckets: string | null;
  negative_buckets: string | null;
  quantiles: string | null;
  exemplars: string | null;
}

interface SpanRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  service: string | null;
  start_time: number | bigint;
  end_time: number | bigint;
  duration: number | bigint;
  status_code: string;
  status_message: string | null;
  attributes: string;
  events: string | null;
  links: string | null;
  scope: string | null;
}

function hydrateLog(row: LogRow): LogData {
  // `body_json` is set only for structured bodies, so its presence is what
  // distinguishes "an object was sent" from "the text happened to be JSON".
  const structured = row.body_json
    ? parseJson<Record<string, unknown>>(row.body_json)
    : undefined;

  return {
    id: row.id,
    timestamp: Number(row.timestamp),
    body: structured ?? row.body_text,
    resourceName: row.service ?? undefined,
    severityText: row.severity_text ?? undefined,
    severityNumber: row.severity_number ?? undefined,
    traceId: row.trace_id ?? undefined,
    spanId: row.span_id ?? undefined,
    attributes: parseJson<LogData['attributes']>(row.attributes) ?? {},
    resource: parseJson<LogData['resource']>(row.resource),
  };
}

function hydratePoint(row: PointRow): MetricPoint {
  return {
    timestamp: Number(row.timestamp),
    startTimestamp:
      row.start_timestamp === null ? undefined : Number(row.start_timestamp),
    attributes: {},
    value: row.value ?? undefined,
    count: row.count ?? undefined,
    sum: row.sum ?? undefined,
    min: row.min ?? undefined,
    max: row.max ?? undefined,
    bucketCounts: parseJson<number[]>(row.bucket_counts),
    explicitBounds: parseJson<number[]>(row.explicit_bounds),
    scale: row.exp_scale ?? undefined,
    zeroCount: row.zero_count ?? undefined,
    zeroThreshold: row.zero_threshold ?? undefined,
    positive: parseJson<MetricPoint['positive']>(row.positive_buckets),
    negative: parseJson<MetricPoint['negative']>(row.negative_buckets),
    quantiles: parseJson<MetricPoint['quantiles']>(row.quantiles),
    exemplars: parseJson<MetricPoint['exemplars']>(row.exemplars),
  };
}

/**
 * Content hash identifying one series.
 *
 * Attribute keys are sorted before hashing so an exporter that emits the same
 * attributes in a different order — which nothing forbids — cannot split one
 * logical series into two chart lines.
 */
function seriesIdentity(
  stream: MetricStreamRecord,
  attributes: SpanAttributes,
): string {
  return createHash('sha256')
    .update(
      [
        stream.name,
        stream.kind,
        stream.unit ?? '',
        stream.service,
        stream.scope?.name ?? '',
        stream.scope?.version ?? '',
        stableJson(stream.resource),
        stableJson(attributes),
      ].join('\u0000'),
    )
    .digest('hex')
    .slice(0, 32);
}

/** JSON with keys sorted, so equal maps always serialize identically. */
function stableJson(value: SpanAttributes): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return JSON.stringify(sorted);
}

function hydrateSpan(row: SpanRow): SpanData {
  return {
    spanId: row.span_id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id ?? undefined,
    name: row.name,
    kind: row.kind as SpanData['kind'],
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    duration: Number(row.duration),
    attributes: parseJson<SpanData['attributes']>(row.attributes) ?? {},
    status: {
      code: row.status_code as SpanData['status']['code'],
      message: row.status_message ?? undefined,
    },
    events: parseJson<SpanData['events']>(row.events) ?? [],
    links: parseJson<SpanData['links']>(row.links) ?? undefined,
    scope: parseJson<SpanData['scope']>(row.scope) ?? undefined,
  };
}

/** Prefer the service that produced the span, falling back to its trace root. */
function spanService(span: SpanData, traceService?: string): string | null {
  const service = span.attributes?.['service.name'];
  return typeof service === 'string' && service.length > 0
    ? service
    : (traceService ?? null);
}

/**
 * Decode stored JSON, tolerating corruption.
 *
 * A single unparseable attribute blob should cost one span its attributes, not
 * fail the whole query — which is what a throw here would do.
 */
function parseJson<T>(text: string | null): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function pragmaNumber(db: DatabaseSync, name: string): number {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<
    string,
    number | bigint
  >;
  return Number(Object.values(row)[0] ?? 0);
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

interface Cursor {
  startTime: number;
  traceId: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.startTime}:${cursor.traceId}`).toString(
    'base64url',
  );
}

/** Decode a cursor, treating anything malformed as "start from the beginning". */
function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    const separator = text.indexOf(':');
    if (separator < 0) return null;
    const startTime = Number(text.slice(0, separator));
    const traceId = text.slice(separator + 1);
    if (!Number.isFinite(startTime) || !traceId) return null;
    return { startTime, traceId };
  } catch {
    return null;
  }
}
