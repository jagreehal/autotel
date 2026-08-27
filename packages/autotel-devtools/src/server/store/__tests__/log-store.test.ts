/**
 * Log storage contract.
 *
 * Logs differ from traces in two ways that matter here. Their body is
 * sometimes structured rather than text, and it has to survive the round trip
 * as what it was — a JSON body flattened to `[object Object]` is a log nobody
 * can read. And severity is the field people actually filter on, so it is a
 * first-class column with a numeric form, because `severity >= 17` (error and
 * above) is the query you want and string comparison cannot express it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevtoolsStore } from '../store';
import type { LogData } from '../../types';

let dir: string;
let store: DevtoolsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'autotel-logs-'));
  store = new DevtoolsStore({ path: join(dir, 'logs.db') });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = 1_700_000_000_000;
let seq = 0;

function log(over: Partial<LogData> = {}): LogData {
  seq++;
  return {
    id: `log-${seq}`,
    body: `message ${seq}`,
    timestamp: T0 + seq * 1000,
    severityText: 'INFO',
    severityNumber: 9,
    resourceName: 'api',
    attributes: {},
    ...over,
  };
}

describe('persistence', () => {
  it('reads back a written log', () => {
    store.ingestLogs([log({ body: 'hello' })]);
    const { logs } = store.queryLogs({ query: '' });
    expect(logs).toHaveLength(1);
    expect(logs[0].body).toBe('hello');
  });

  it('is idempotent on a replayed log', () => {
    const entry = log();
    store.ingestLogs([entry]);
    store.ingestLogs([entry]);
    expect(store.queryLogs({ query: '' }).logs).toHaveLength(1);
  });

  it('does not replace the attribute index when a replayed log is ignored', () => {
    const entry = log({ attributes: { color: 'red' } });
    store.ingestLogs([entry]);
    store.ingestLogs([{ ...entry, attributes: { color: 'blue' } }]);

    expect(store.queryLogs({ query: 'color = blue' }).logs).toEqual([]);
  });

  it('preserves a structured body as structure, not as text', () => {
    // A JSON body flattened to "[object Object]" is a log nobody can read.
    store.ingestLogs([
      log({ body: { event: 'checkout', items: 3, ok: true } }),
    ]);
    const { logs } = store.queryLogs({ query: '' });
    expect(logs[0].body).toEqual({ event: 'checkout', items: 3, ok: true });
  });

  it('keeps the trace and span a log belongs to', () => {
    store.ingestLogs([log({ traceId: 't1', spanId: 's1' })]);
    const [entry] = store.queryLogs({ query: '' }).logs;
    expect(entry.traceId).toBe('t1');
    expect(entry.spanId).toBe('s1');
  });

  it('survives a close and reopen', () => {
    const path = join(dir, 'persist.db');
    const first = new DevtoolsStore({ path });
    first.ingestLogs([log()]);
    first.close();

    const second = new DevtoolsStore({ path });
    expect(second.queryLogs({ query: '' }).logs).toHaveLength(1);
    second.close();
  });

  it('returns newest first, as a log view reads', () => {
    store.ingestLogs([
      log({ timestamp: T0 + 1000 }),
      log({ timestamp: T0 + 3000 }),
      log({ timestamp: T0 + 2000 }),
    ]);
    const times = store.queryLogs({ query: '' }).logs.map((l) => l.timestamp);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe('querying', () => {
  beforeEach(() => {
    store.ingestLogs([
      log({
        body: 'user signed in',
        severityText: 'INFO',
        severityNumber: 9,
        resourceName: 'api',
        attributes: { 'user.id': 'u1' },
        timestamp: T0 + 1000,
      }),
      log({
        body: 'payment failed',
        severityText: 'ERROR',
        severityNumber: 17,
        resourceName: 'api',
        attributes: { 'user.id': 'u2' },
        traceId: 't-bad',
        timestamp: T0 + 2000,
      }),
      log({
        body: 'job queued',
        severityText: 'DEBUG',
        severityNumber: 5,
        resourceName: 'worker',
        timestamp: T0 + 3000,
      }),
    ]);
  });

  it('returns everything for an empty query', () => {
    expect(store.queryLogs({ query: '' }).logs).toHaveLength(3);
  });

  it('filters by service', () => {
    const { logs } = store.queryLogs({ query: 'service = worker' });
    expect(logs.map((l) => l.body)).toEqual(['job queued']);
  });

  it('filters by severity text', () => {
    const { logs } = store.queryLogs({ query: 'severity = ERROR' });
    expect(logs.map((l) => l.body)).toEqual(['payment failed']);
  });

  it('filters by numeric severity, which is what "error and above" needs', () => {
    // String comparison cannot express this; the numeric column can.
    const { logs } = store.queryLogs({ query: 'severity_number >= 17' });
    expect(logs.map((l) => l.body)).toEqual(['payment failed']);
  });

  it('matches free text against the body', () => {
    const { logs } = store.queryLogs({ query: 'payment' });
    expect(logs).toHaveLength(1);
  });

  it('filters by a log attribute', () => {
    const { logs } = store.queryLogs({ query: 'user.id = u2' });
    expect(logs.map((l) => l.body)).toEqual(['payment failed']);
  });

  it('filters by trace id, to see the logs belonging to one trace', () => {
    const { logs } = store.queryLogs({ query: 'trace_id = "t-bad"' });
    expect(logs).toHaveLength(1);
  });

  it('combines conditions', () => {
    const { logs } = store.queryLogs({
      query: 'service = api AND severity_number >= 17',
    });
    expect(logs).toHaveLength(1);
  });

  it('honours a time window', () => {
    const { logs } = store.queryLogs({
      query: '',
      window: { start: T0 + 2500, end: T0 + 4000 },
    });
    expect(logs.map((l) => l.body)).toEqual(['job queued']);
  });

  it('pages with a cursor', () => {
    const first = store.queryLogs({ query: '', limit: 2 });
    expect(first.logs).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = store.queryLogs({
      query: '',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.logs).toHaveLength(1);
    expect(new Set([...first.logs, ...second.logs].map((l) => l.id)).size).toBe(
      3,
    );
  });

  it('reports an invalid query rather than throwing', () => {
    const result = store.queryLogs({ query: 'service =' });
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.logs).toEqual([]);
  });

  it('does not execute injected SQL', () => {
    const result = store.queryLogs({
      query: `service = "api'; DROP TABLE logs; --"`,
    });
    expect(result.logs).toEqual([]);
    expect(store.queryLogs({ query: '' }).logs).toHaveLength(3);
  });

  it('searches a structured body by its serialized form', () => {
    // What the user sees in the row is the serialized body, so that is what a
    // free-text search has to match against.
    store.ingestLogs([log({ body: { kind: 'audit', actor: 'admin' } })]);
    const { logs } = store.queryLogs({ query: 'admin' });
    expect(logs).toHaveLength(1);
  });
});

describe('retention', () => {
  it('drops the oldest logs past the cap', () => {
    const capped = new DevtoolsStore({
      path: join(dir, 'capped.db'),
      maxLogs: 3,
    });
    capped.ingestLogs(
      Array.from({ length: 6 }, (_, i) =>
        log({ body: `m${i}`, timestamp: T0 + i * 1000 }),
      ),
    );
    capped.enforceRetention();

    const { logs } = capped.queryLogs({ query: '' });
    expect(logs).toHaveLength(3);
    expect(logs.map((l) => l.body).sort()).toEqual(['m3', 'm4', 'm5']);
    capped.close();
  });

  it('clear removes logs too', () => {
    store.ingestLogs([log()]);
    store.clear();
    expect(store.queryLogs({ query: '' }).logs).toEqual([]);
  });
});
