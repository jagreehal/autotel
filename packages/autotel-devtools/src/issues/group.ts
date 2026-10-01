// Occurrences → issues, for one window. Used where there is no stored issue
// state (autotel-mcp over a plain backend); devtools keeps the same shape in
// sqlite and adds status on top.

import type { IssueSource, Occurrence } from './occurrence';

export type IssueStatus = 'active' | 'resolved' | 'ignored';

export interface Issue {
  fingerprint: string;
  service: string;
  source: IssueSource;
  title: string;
  type?: string;
  message: string;
  culprit?: string;
  operation?: string;
  status: IssueStatus;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Occurrences per equal-width bucket across the window, oldest first. */
  trend: number[];
  /** Came back after a gap of `quietMs` or more between two occurrences. */
  regression: boolean;
  versions: string[];
  affected: { users: number; accounts: number; sessions: number };
  /** Newest first. */
  sampleTraceIds: string[];
  latestStack?: string;
}

export interface GroupOptions {
  start: number;
  end: number;
  quietMs: number;
  buckets?: number;
}

export function titleOf(o: Pick<Occurrence, 'type' | 'message'>): string {
  return o.type && !o.message.startsWith(o.type)
    ? `${o.type}: ${o.message}`
    : o.message;
}

function distinct<T>(values: Array<T | undefined>): T[] {
  return [...new Set(values.filter((v): v is T => v !== undefined))];
}

/** Summarise one fingerprint's occurrences (any order). */
export function summarize(
  occurrences: Occurrence[],
  options: GroupOptions,
  status: IssueStatus = 'active',
): Issue {
  const list = [...occurrences].sort((a, b) => a.timestamp - b.timestamp);
  const first = list[0]!;
  const last = list.at(-1)!;
  const buckets = options.buckets ?? 12;
  const width = Math.max(1, (options.end - options.start) / buckets);
  const trend = Array.from({ length: buckets }, () => 0);
  let regression = false;
  for (const [index, occurrence] of list.entries()) {
    const bucket = Math.floor((occurrence.timestamp - options.start) / width);
    trend[Math.min(buckets - 1, Math.max(0, bucket))]! += 1;
    const previous = list[index - 1];
    if (
      previous &&
      occurrence.timestamp - previous.timestamp >= options.quietMs
    ) {
      regression = true;
    }
  }
  const newestFirst = [...list].reverse();
  return {
    fingerprint: first.fingerprint,
    service: first.service,
    source: first.source,
    title: titleOf(last),
    type: first.type,
    message: last.message,
    culprit: first.culprit,
    operation: first.operation,
    status,
    count: list.length,
    firstSeen: first.timestamp,
    lastSeen: last.timestamp,
    trend,
    regression,
    versions: distinct(list.map((o) => o.version)),
    affected: {
      users: distinct(list.map((o) => o.userId)).length,
      accounts: distinct(list.map((o) => o.accountId)).length,
      sessions: distinct(list.map((o) => o.sessionId)).length,
    },
    sampleTraceIds: distinct(newestFirst.map((o) => o.traceId)).slice(0, 5),
    latestStack: newestFirst.find((o) => o.stack)?.stack,
  };
}

export function groupOccurrences(
  occurrences: Occurrence[],
  options: GroupOptions,
): Issue[] {
  const byFingerprint = new Map<string, Occurrence[]>();
  const seen = new Set<string>();
  for (const occurrence of occurrences) {
    if (seen.has(occurrence.id)) continue;
    seen.add(occurrence.id);
    const list = byFingerprint.get(occurrence.fingerprint) ?? [];
    list.push(occurrence);
    byFingerprint.set(occurrence.fingerprint, list);
  }
  return [...byFingerprint.values()]
    .map((list) => summarize(list, options))
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}
