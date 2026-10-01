// Issue state on the devtools sqlite file: what an error tracker has to
// remember that raw telemetry does not — status, lifetime counts that outlive
// the occurrences, destinations, automations, and every automation run.
//
// Additive tables (`CREATE TABLE IF NOT EXISTS`), so an older `--db` file just
// gains them; nothing here changes the schema the rest of the store reads.

import type { DatabaseSync } from 'node:sqlite';
import {
  summarize,
  type Automation,
  type Destination,
  type Issue,
  type IssueStatus,
  type Occurrence,
  type OccurrenceStep,
  type SendTrigger,
} from '../../issues';

const DDL = `
CREATE TABLE IF NOT EXISTS issues (
  fingerprint       TEXT PRIMARY KEY,
  service           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  status_changed_at INTEGER NOT NULL,
  first_seen        INTEGER NOT NULL,
  last_seen         INTEGER NOT NULL,
  count             INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS issue_occurrences (
  id          TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  trace_id    TEXT,
  body        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_occurrences ON issue_occurrences(fingerprint, timestamp);
CREATE TABLE IF NOT EXISTS issue_destinations (
  id   TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issue_automations (
  id   TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issue_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id  TEXT,
  destination_id TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  trigger        TEXT NOT NULL,
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     INTEGER NOT NULL,
  finished_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_issue_runs_fp ON issue_runs(fingerprint, created_at);
`;

export interface IssueRow {
  fingerprint: string;
  service: string;
  status: IssueStatus;
  statusChangedAt: number;
  firstSeen: number;
  lastSeen: number;
  count: number;
}

export interface RecordResult {
  /** False when this occurrence id was already counted under this fingerprint. */
  isNew: boolean;
  step: OccurrenceStep;
  /** A resolved issue that this occurrence moved back to active. */
  reopened: boolean;
}

export type RunStatus = 'pending' | 'succeeded' | 'failed';

export interface IssueRun {
  id: number;
  automationId?: string;
  destinationId: string;
  fingerprint: string;
  trigger: SendTrigger;
  status: RunStatus;
  attempts: number;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

export interface ListIssuesQuery {
  status?: IssueStatus;
  service?: string;
  /** Window for trend, affected and samples. Counts and seen-times are lifetime. */
  start: number;
  end: number;
  quietMs?: number;
  limit?: number;
}

type Row = Record<string, unknown>;

function toIssueRow(row: Row): IssueRow {
  return {
    fingerprint: String(row.fingerprint),
    service: String(row.service),
    status: String(row.status) as IssueStatus,
    statusChangedAt: Number(row.status_changed_at),
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
    count: Number(row.count),
  };
}

function toRun(row: Row): IssueRun {
  return {
    id: Number(row.id),
    ...(row.automation_id ? { automationId: String(row.automation_id) } : {}),
    destinationId: String(row.destination_id),
    fingerprint: String(row.fingerprint),
    trigger: String(row.trigger) as SendTrigger,
    status: String(row.status) as RunStatus,
    attempts: Number(row.attempts),
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: Number(row.created_at),
    ...(row.finished_at ? { finishedAt: Number(row.finished_at) } : {}),
  };
}

export class IssueStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(DDL);
  }

  getRow(fingerprint: string): IssueRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM issues WHERE fingerprint = ?')
      .get(fingerprint) as Row | undefined;
    return row ? toIssueRow(row) : undefined;
  }

  /**
   * Count one occurrence. Idempotent by occurrence id: exporters retry, and a
   * trace arriving in several batches is re-evaluated as it grows. When a
   * later batch changes which issue the trace belongs to (the throw site
   * arrived after its 500), the occurrence moves.
   */
  record(occurrence: Occurrence): RecordResult {
    const existing = this.db
      .prepare('SELECT fingerprint FROM issue_occurrences WHERE id = ?')
      .get(occurrence.id) as Row | undefined;
    if (existing && existing.fingerprint === occurrence.fingerprint) {
      // Same failure seen again as its trace grew: keep the richer details.
      this.db
        .prepare('UPDATE issue_occurrences SET body = ? WHERE id = ?')
        .run(JSON.stringify(occurrence), occurrence.id);
      const row = this.getRow(occurrence.fingerprint)!;
      return {
        isNew: false,
        reopened: false,
        step: {
          service: row.service,
          status: row.status,
          previousCount: row.count,
          previousLastSeen: row.lastSeen,
          timestamp: occurrence.timestamp,
        },
      };
    }
    if (existing) {
      this.db
        .prepare('DELETE FROM issue_occurrences WHERE id = ?')
        .run(occurrence.id);
      this.db
        .prepare(
          'UPDATE issues SET count = MAX(0, count - 1) WHERE fingerprint = ?',
        )
        .run(String(existing.fingerprint));
    }

    const before = this.getRow(occurrence.fingerprint);
    const step: OccurrenceStep = {
      service: occurrence.service,
      status: before?.status ?? 'active',
      previousCount: before?.count ?? 0,
      ...(before ? { previousLastSeen: before.lastSeen } : {}),
      timestamp: occurrence.timestamp,
    };
    // Cloudflare's rule: a newer occurrence reopens a resolved issue, but one
    // that happened before the resolve (a late batch) does not.
    const reopened =
      before?.status === 'resolved' &&
      occurrence.timestamp > before.statusChangedAt;

    this.db
      .prepare(
        'INSERT INTO issue_occurrences (id, fingerprint, timestamp, trace_id, body) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        occurrence.id,
        occurrence.fingerprint,
        occurrence.timestamp,
        occurrence.traceId ?? null,
        JSON.stringify(occurrence),
      );
    if (before) {
      this.db
        .prepare(
          `UPDATE issues SET count = count + 1,
             first_seen = MIN(first_seen, ?), last_seen = MAX(last_seen, ?),
             status = CASE WHEN ? THEN 'active' ELSE status END,
             status_changed_at = CASE WHEN ? THEN ? ELSE status_changed_at END
           WHERE fingerprint = ?`,
        )
        .run(
          occurrence.timestamp,
          occurrence.timestamp,
          reopened ? 1 : 0,
          reopened ? 1 : 0,
          occurrence.timestamp,
          occurrence.fingerprint,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO issues (fingerprint, service, status, status_changed_at, first_seen, last_seen, count)
           VALUES (?, ?, 'active', ?, ?, ?, 1)`,
        )
        .run(
          occurrence.fingerprint,
          occurrence.service,
          occurrence.timestamp,
          occurrence.timestamp,
          occurrence.timestamp,
        );
    }
    return { isNew: true, step, reopened };
  }

  occurrences(
    fingerprint: string,
    start = 0,
    end = Number.MAX_SAFE_INTEGER,
  ): Occurrence[] {
    const rows = this.db
      .prepare(
        'SELECT body FROM issue_occurrences WHERE fingerprint = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp',
      )
      .all(fingerprint, start, end) as Row[];
    return rows.map((row) => JSON.parse(String(row.body)) as Occurrence);
  }

  /** Lifetime counters from the issue row; trend, affected and samples from the window. */
  private assemble(
    row: IssueRow,
    start: number,
    end: number,
    quietMs: number,
  ): Issue | undefined {
    let window = this.occurrences(row.fingerprint, start, end);
    // Past the window (or past retention) the latest known occurrence still
    // names the issue.
    if (window.length === 0)
      window = this.occurrences(row.fingerprint).slice(-1);
    if (window.length === 0) return undefined;
    return {
      ...summarize(window, { start, end, quietMs }, row.status),
      count: row.count,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
    };
  }

  list(query: ListIssuesQuery): Issue[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (query.status) {
      where.push('status = ?');
      args.push(query.status);
    }
    if (query.service) {
      where.push('service = ?');
      args.push(query.service);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM issues ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY last_seen DESC LIMIT ?`,
      )
      .all(...args, query.limit ?? 100) as Row[];
    return rows
      .map((row) =>
        this.assemble(
          toIssueRow(row),
          query.start,
          query.end,
          query.quietMs ?? 3_600_000,
        ),
      )
      .filter((issue): issue is Issue => issue !== undefined);
  }

  get(
    fingerprint: string,
    start: number,
    end: number,
    quietMs = 3_600_000,
  ): Issue | undefined {
    const row = this.getRow(fingerprint);
    return row ? this.assemble(row, start, end, quietMs) : undefined;
  }

  setStatus(fingerprint: string, status: IssueStatus, at: number): boolean {
    const result = this.db
      .prepare(
        'UPDATE issues SET status = ?, status_changed_at = ? WHERE fingerprint = ?',
      )
      .run(status, at, fingerprint);
    return Number(result.changes) > 0;
  }

  /**
   * Occurrence details expire (seven days by default). Each issue keeps its
   * latest occurrence so it stays listed, and titled, after the rest expire.
   */
  pruneOccurrences(olderThan: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM issue_occurrences WHERE timestamp < ? AND timestamp <
           (SELECT MAX(o.timestamp) FROM issue_occurrences o WHERE o.fingerprint = issue_occurrences.fingerprint)`,
      )
      .run(olderThan);
    return Number(result.changes);
  }

  // Destinations and automations are small config documents: stored as JSON.

  listDestinations(): Destination[] {
    return (
      this.db.prepare('SELECT body FROM issue_destinations').all() as Row[]
    ).map((row) => JSON.parse(String(row.body)) as Destination);
  }

  getDestination(id: string): Destination | undefined {
    const row = this.db
      .prepare('SELECT body FROM issue_destinations WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? (JSON.parse(String(row.body)) as Destination) : undefined;
  }

  saveDestination(destination: Destination): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO issue_destinations (id, body) VALUES (?, ?)',
      )
      .run(destination.id, JSON.stringify(destination));
  }

  deleteDestination(id: string): boolean {
    return (
      Number(
        this.db.prepare('DELETE FROM issue_destinations WHERE id = ?').run(id)
          .changes,
      ) > 0
    );
  }

  listAutomations(): Automation[] {
    return (
      this.db.prepare('SELECT body FROM issue_automations').all() as Row[]
    ).map((row) => JSON.parse(String(row.body)) as Automation);
  }

  saveAutomation(automation: Automation): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO issue_automations (id, body) VALUES (?, ?)',
      )
      .run(automation.id, JSON.stringify(automation));
  }

  deleteAutomation(id: string): boolean {
    return (
      Number(
        this.db.prepare('DELETE FROM issue_automations WHERE id = ?').run(id)
          .changes,
      ) > 0
    );
  }

  /** A threshold automation runs once per issue, even across restarts. */
  hasRun(
    automationId: string,
    fingerprint: string,
    trigger: SendTrigger,
  ): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM issue_runs WHERE automation_id = ? AND fingerprint = ? AND trigger = ? LIMIT 1',
        )
        .get(automationId, fingerprint, trigger) !== undefined
    );
  }

  startRun(run: {
    automationId?: string;
    destinationId: string;
    fingerprint: string;
    trigger: SendTrigger;
    at: number;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO issue_runs (automation_id, destination_id, fingerprint, trigger, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        run.automationId ?? null,
        run.destinationId,
        run.fingerprint,
        run.trigger,
        run.at,
      );
    return Number(result.lastInsertRowid);
  }

  finishRun(
    id: number,
    outcome: { ok: boolean; attempts: number; error?: string },
    at: number,
  ): void {
    this.db
      .prepare(
        'UPDATE issue_runs SET status = ?, attempts = ?, error = ?, finished_at = ? WHERE id = ?',
      )
      .run(
        outcome.ok ? 'succeeded' : 'failed',
        outcome.attempts,
        outcome.error ?? null,
        at,
        id,
      );
  }

  /** Run history, newest first; kept 30 days like Cloudflare's. */
  runs(
    filter: {
      fingerprint?: string;
      automationId?: string;
      limit?: number;
    } = {},
  ): IssueRun[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.fingerprint) {
      where.push('fingerprint = ?');
      args.push(filter.fingerprint);
    }
    if (filter.automationId) {
      where.push('automation_id = ?');
      args.push(filter.automationId);
    }
    return (
      this.db
        .prepare(
          `SELECT * FROM issue_runs ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...args, filter.limit ?? 50) as Row[]
    ).map(toRun);
  }

  pruneRuns(olderThan: number): void {
    this.db
      .prepare('DELETE FROM issue_runs WHERE created_at < ?')
      .run(olderThan);
  }
}
