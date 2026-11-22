import type { LogRecord, SpanRecord } from '../types';
import { getSpanFieldValues } from './query-filters';
import { percentile } from './service-map';

/**
 * Aggregation over spans and logs the backend already returned: what an agent
 * would otherwise do by reading raw traces into its context and counting.
 * Pure, so every backend gets it; a backend that can aggregate server-side
 * answers with exact numbers instead (`TelemetryBackend.aggregateSpans`).
 */

export interface LatencyStats {
  count: number;
  errorCount: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface SpanAggregateRow extends LatencyStats {
  group: Record<string, string>;
  /** Absent when the backend aggregated server-side. */
  firstSeenUnixMs?: number;
  lastSeenUnixMs?: number;
  buckets?: Array<{ startUnixMs: number } & LatencyStats>;
}

/** Grouped by the same field names a filter takes, plus `version`. */
export function spanGroupValue(span: SpanRecord, field: string): string {
  if (field === 'version') return spanVersion(span) ?? '(none)';
  const value = getSpanFieldValues(span, field)[0];
  return value === undefined ? '(none)' : String(value);
}

/** OTel's `service.version`; Datadog files the same value as `version`. */
export function spanVersion(span: SpanRecord): string | undefined {
  const value = span.tags['service.version'] ?? span.tags.version;
  return value === undefined ? undefined : String(value);
}

export function latencyStats(spans: readonly SpanRecord[]): LatencyStats {
  const durations = spans.map((span) => span.durationMs).sort((a, b) => a - b);
  const errorCount = spans.filter((span) => span.hasError).length;
  const total = durations.reduce((sum, value) => sum + value, 0);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    count: spans.length,
    errorCount,
    errorRate: spans.length === 0 ? 0 : round(errorCount / spans.length),
    avgMs: spans.length === 0 ? 0 : round(total / spans.length),
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    p99Ms: round(percentile(durations, 0.99)),
    maxMs: round(durations.at(-1) ?? 0),
  };
}

export function aggregateSpans(
  spans: readonly SpanRecord[],
  options: { groupBy?: readonly string[]; bucketMinutes?: number } = {},
): SpanAggregateRow[] {
  const groupBy = options.groupBy ?? [];
  const groups = new Map<
    string,
    { group: Record<string, string>; spans: SpanRecord[] }
  >();
  for (const span of spans) {
    const group = Object.fromEntries(
      groupBy.map((field) => [field, spanGroupValue(span, field)]),
    );
    const key = JSON.stringify(group);
    const entry = groups.get(key);
    if (entry) entry.spans.push(span);
    else groups.set(key, { group, spans: [span] });
  }

  const bucketMs = (options.bucketMinutes ?? 0) * 60_000;
  return Array.from(groups.values(), ({ group, spans: members }) => {
    const starts = members.map((span) => span.startTimeUnixMs);
    const row: SpanAggregateRow = {
      group,
      ...latencyStats(members),
      firstSeenUnixMs: Math.min(...starts),
      lastSeenUnixMs: Math.max(...starts),
    };
    if (bucketMs > 0) row.buckets = bucketize(members, bucketMs);
    return row;
  }).sort((a, b) => b.count - a.count);
}

function bucketize(
  spans: readonly SpanRecord[],
  bucketMs: number,
): NonNullable<SpanAggregateRow['buckets']> {
  const buckets = new Map<number, SpanRecord[]>();
  for (const span of spans) {
    const start = Math.floor(span.startTimeUnixMs / bucketMs) * bucketMs;
    const bucket = buckets.get(start);
    if (bucket) bucket.push(span);
    else buckets.set(start, [span]);
  }
  return Array.from(buckets, ([startUnixMs, members]) => ({
    startUnixMs,
    ...latencyStats(members),
  })).sort((a, b) => a.startUnixMs - b.startUnixMs);
}

export interface VersionChange {
  service: string;
  from: string;
  to: string;
  /** When the new version's first span in the sample started. */
  changedAtUnixMs: number;
  /**
   * When the sample could first tell this was a change: `changedAtUnixMs`
   * for a version never seen before; for a return to an earlier one, the
   * span that completed its confirmation, which can be later.
   */
  confirmedAtUnixMs: number;
  before: LatencyStats;
  after: LatencyStats;
  /** Positive is worse. */
  errorRateDelta: number;
  p95DeltaMs: number;
}

/**
 * A flag definition that changed: a rollout widened, a kill switch flipped.
 * With trunk-based development this changes behaviour as often as a deploy
 * does, and `service.version` never moves.
 */
export interface FlagChange extends VersionChange {
  /** `feature_flag.key`; `from`/`to` are its `feature_flag.version`. */
  flag: string;
}

export interface WhatChangedResult {
  changes: VersionChange[];
  /** Flags whose `feature_flag.version` changed, newest first. */
  flagChanges: FlagChange[];
  /** Services seen on one version only across the window. */
  unchanged: Array<{ service: string; version: string }>;
  /** Services whose spans carry no version at all. */
  unversioned: string[];
}

function groupBy(
  spans: readonly SpanRecord[],
  keyOf: (span: SpanRecord) => string | undefined,
): Map<string, SpanRecord[]> {
  const groups = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    const key = keyOf(span);
    if (key === undefined) continue;
    const list = groups.get(key);
    if (list) list.push(span);
    else groups.set(key, [span]);
  }
  return groups;
}

/**
 * Each version the spans moved to, in time order, with the stats either side.
 * One version means nothing changed.
 *
 * A version never seen before is a change the moment it appears. A version
 * seen before (a rollback, or a rollout repeated after one) is a change once
 * it fills the next {@link CONFIRM_SPANS} spans in a row: during a rolling
 * deploy the old and new versions interleave, and that is one change, not a
 * flip at every span. Spans of a third version confirm nothing about it.
 */
/** Spans in a row of an earlier version that confirm a return to it. */
const CONFIRM_SPANS = 3;

/** The versions a service's spans moved through, and each change between them. */
interface Transitions {
  versions: string[];
  changes: Omit<VersionChange, 'service'>[];
}

function transitions(
  spans: readonly SpanRecord[],
  versionOf: (span: SpanRecord) => string | undefined,
): Transitions {
  const versioned = spans
    .map((span) => ({ span, version: versionOf(span) }))
    .filter(
      (entry): entry is { span: SpanRecord; version: string } =>
        entry.version !== undefined,
    )
    .sort((a, b) => a.span.startTimeUnixMs - b.span.startTimeUnixMs);
  // A full run is needed: a sample's last span or two of the old version
  // are stragglers, not a rollback, until more spans say otherwise.
  const fillsNext = (version: string, index: number) => {
    const next = versioned.slice(index, index + CONFIRM_SPANS);
    return (
      next.length === CONFIRM_SPANS &&
      next.every((entry) => entry.version === version)
    );
  };

  const seen = new Set<string>();
  const switches: Array<{
    from: string;
    to: string;
    at: number;
    confirmedAt: number;
  }> = [];
  let current: string | undefined;
  versioned.forEach(({ version }, index) => {
    if (current === undefined) current = version;
    else if (
      version !== current &&
      (!seen.has(version) || fillsNext(version, index))
    ) {
      const confirmedBy = seen.has(version) ? index + CONFIRM_SPANS - 1 : index;
      switches.push({
        from: current,
        to: version,
        at: index,
        confirmedAt: versioned[confirmedBy]!.span.startTimeUnixMs,
      });
      current = version;
    }
    seen.add(version);
  });

  const changes = switches.map(({ from, to, at, confirmedAt }, index) => {
    const changedAtUnixMs = versioned[at]!.span.startTimeUnixMs;
    const until = switches[index + 1]?.at ?? versioned.length;
    const before = latencyStats(
      versioned
        .slice(index === 0 ? 0 : switches[index - 1]!.at, at)
        .filter((entry) => entry.version === from)
        .map((entry) => entry.span),
    );
    const after = latencyStats(
      versioned
        .slice(at, until)
        .filter((entry) => entry.version === to)
        .map((entry) => entry.span),
    );
    return {
      from,
      to,
      changedAtUnixMs,
      confirmedAtUnixMs: confirmedAt,
      before,
      after,
      errorRateDelta:
        Math.round((after.errorRate - before.errorRate) * 1000) / 1000,
      p95DeltaMs: Math.round((after.p95Ms - before.p95Ms) * 1000) / 1000,
    };
  });
  return { versions: Array.from(seen), changes };
}

function tag(span: SpanRecord, key: string): string | undefined {
  const value = span.tags[key];
  return value === undefined ? undefined : String(value);
}

/**
 * Deployments as the spans record them: a service whose `service.version`
 * changes inside the window, with its error rate and p95 before and after.
 * Works on any backend because it needs no deploy events, only the version
 * every OTel SDK stamps on the resource.
 *
 * Flag changes the same way, from `feature_flag.version` on spans that
 * evaluated the flag, per service, since each service that read the flag is
 * a place its new definition can break.
 */
export function whatChanged(spans: readonly SpanRecord[]): WhatChangedResult {
  const result: WhatChangedResult = {
    changes: [],
    flagChanges: [],
    unchanged: [],
    unversioned: [],
  };
  for (const [service, members] of groupBy(spans, (s) => s.serviceName)) {
    const { versions, changes } = transitions(members, spanVersion);
    if (versions.length === 0) result.unversioned.push(service);
    else if (versions.length === 1)
      result.unchanged.push({ service, version: versions[0]! });
    for (const change of changes) result.changes.push({ service, ...change });
  }

  for (const [service, serviceSpans] of groupBy(spans, (s) => s.serviceName)) {
    const byFlag = groupBy(serviceSpans, (s) => tag(s, 'feature_flag.key'));
    for (const [flag, members] of byFlag) {
      const { changes } = transitions(members, (span) =>
        tag(span, 'feature_flag.version'),
      );
      for (const change of changes)
        result.flagChanges.push({ service, flag, ...change });
    }
  }

  result.changes.sort((a, b) => b.changedAtUnixMs - a.changedAtUnixMs);
  result.flagChanges.sort((a, b) => b.changedAtUnixMs - a.changedAtUnixMs);
  return result;
}

export interface LogAggregateRow {
  group: Record<string, string>;
  count: number;
  /** Most frequent message shapes in the group, ids and numbers masked. */
  patterns: Array<{ pattern: string; count: number; example: string }>;
}

function logGroupValue(log: LogRecord, field: string): string {
  if (field === 'service') return log.serviceName ?? '(none)';
  if (field === 'severity') return log.severityText;
  const value = log.attributes?.[field];
  return value === undefined ? '(none)' : String(value);
}

/**
 * A log line with its variable parts masked, so "user 42 not found" and
 * "user 97 not found" count as one message. Order matters: longer, more
 * specific shapes go first so a UUID is not half-eaten by the number rule.
 */
export function logPattern(body: string): string {
  if (body.trim() === '') return '(empty message)';
  return body
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<uuid>',
    )
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/"[^"]*"|'[^']*'/g, '<str>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .slice(0, 300);
}

export function aggregateLogs(
  logs: readonly LogRecord[],
  options: { groupBy?: readonly string[]; patternsPerGroup?: number } = {},
): LogAggregateRow[] {
  const groupBy = options.groupBy ?? [];
  const keep = options.patternsPerGroup ?? 5;
  const groups = new Map<
    string,
    {
      group: Record<string, string>;
      count: number;
      patterns: Map<string, { count: number; example: string }>;
    }
  >();
  for (const log of logs) {
    const group = Object.fromEntries(
      groupBy.map((field) => [field, logGroupValue(log, field)]),
    );
    const key = JSON.stringify(group);
    let entry = groups.get(key);
    if (!entry) {
      entry = { group, count: 0, patterns: new Map() };
      groups.set(key, entry);
    }
    entry.count++;
    const pattern = logPattern(log.body);
    const seen = entry.patterns.get(pattern);
    if (seen) seen.count++;
    else
      entry.patterns.set(pattern, {
        count: 1,
        example: log.body.slice(0, 300),
      });
  }
  return Array.from(groups.values(), ({ group, count, patterns }) => ({
    group,
    count,
    patterns: Array.from(patterns, ([pattern, value]) => ({
      pattern,
      ...value,
    }))
      .sort((a, b) => b.count - a.count)
      .slice(0, keep),
  })).sort((a, b) => b.count - a.count);
}
