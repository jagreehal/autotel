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

/** Shorthands an agent reaches for first; anything else is a tag or field. */
export function spanGroupValue(span: SpanRecord, field: string): string {
  if (field === 'service') return span.serviceName;
  if (field === 'operation') return span.operationName;
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
  before: LatencyStats;
  after: LatencyStats;
  /** Positive is worse. */
  errorRateDelta: number;
  p95DeltaMs: number;
}

export interface WhatChangedResult {
  changes: VersionChange[];
  /** Services seen on one version only across the window. */
  unchanged: Array<{ service: string; version: string }>;
  /** Services whose spans carry no version at all. */
  unversioned: string[];
}

/**
 * Deployments as the spans record them: a service whose `service.version`
 * changes inside the window, with its error rate and p95 before and after.
 * Works on any backend because it needs no deploy events, only the version
 * every OTel SDK stamps on the resource.
 */
export function whatChanged(spans: readonly SpanRecord[]): WhatChangedResult {
  const byService = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    const list = byService.get(span.serviceName);
    if (list) list.push(span);
    else byService.set(span.serviceName, [span]);
  }

  const result: WhatChangedResult = {
    changes: [],
    unchanged: [],
    unversioned: [],
  };
  for (const [service, members] of byService) {
    const versioned = members.filter((span) => spanVersion(span) !== undefined);
    if (versioned.length === 0) {
      result.unversioned.push(service);
      continue;
    }
    const firstSeen = new Map<string, number>();
    for (const span of versioned) {
      const version = spanVersion(span)!;
      const seen = firstSeen.get(version);
      if (seen === undefined || span.startTimeUnixMs < seen)
        firstSeen.set(version, span.startTimeUnixMs);
    }
    const order = Array.from(firstSeen).sort((a, b) => a[1] - b[1]);
    if (order.length === 1) {
      result.unchanged.push({ service, version: order[0]![0] });
      continue;
    }
    for (let index = 1; index < order.length; index++) {
      const [previous] = order[index - 1]!;
      const [next, changedAtUnixMs] = order[index]!;
      const before = latencyStats(
        versioned.filter((span) => spanVersion(span) === previous),
      );
      const after = latencyStats(
        versioned.filter((span) => spanVersion(span) === next),
      );
      result.changes.push({
        service,
        from: previous,
        to: next,
        changedAtUnixMs,
        before,
        after,
        errorRateDelta:
          Math.round((after.errorRate - before.errorRate) * 1000) / 1000,
        p95DeltaMs: Math.round((after.p95Ms - before.p95Ms) * 1000) / 1000,
      });
    }
  }
  result.changes.sort((a, b) => b.changedAtUnixMs - a.changedAtUnixMs);
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
