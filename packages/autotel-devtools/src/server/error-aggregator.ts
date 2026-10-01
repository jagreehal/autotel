/**
 * Live issue groups for the Errors tab and the WebSocket full-state broadcast.
 *
 * The same rules as the stored issues (`src/issues`): one occurrence per
 * trace, picked by `occurrenceFromTrace`, plus error logs outside any trace.
 * So everything the Issues store records (thrown and handled exceptions, 5xx,
 * log floods, runaway alarms, standalone error logs) shows up here too, under
 * the same fingerprint, which is what lets the tab resolve and send it.
 *
 * In memory and bounded; the store (`store/issues.ts`) is what persists.
 *
 * @example
 * ```typescript
 * const aggregator = new ErrorAggregator({ maxGroups: 100 });
 * aggregator.addTrace(trace); // idempotent: call again as the trace grows
 * aggregator.addLog(log);
 * aggregator.getErrorGroups();
 * ```
 */

import {
  occurrenceFromLog,
  occurrenceFromTrace,
  type IssueSource,
  type Occurrence,
} from '../issues';
import { traceToIssueSpans, logToIssueLog } from './issue-input';
import type { ErrorGroup, LogData, TraceData } from './types';

/** How many errors the aggregator is holding, and what they are. */
export interface ErrorStats {
  totalGroups: number;
  totalErrors: number;
  recentErrors: number;
  topErrorTypes: Array<{ type: string; count: number }>;
}

export interface ErrorAggregatorOptions {
  /** Maximum groups tracked; the least recently seen is evicted. Default 100. */
  maxGroups?: number;
  /** Trace ids kept per group, newest last. Default 10. */
  maxAffectedTraces?: number;
  /** Operation names kept per group. Default 5. */
  maxAffectedSpans?: number;
}

/** What to call a failure that carried no exception type. */
const DEFAULT_TYPE: Record<IssueSource, string> = {
  exception: 'Error',
  handled_exception: 'Error',
  http_5xx: 'HTTP 5xx',
  error_log: 'Error log',
  log_flood: 'autotel.LogFlood',
  runaway_alarm: 'autotel.RunawayAlarm',
};

/** Which trace counted toward which group, so a re-sent trace counts once. */
const MAX_REMEMBERED_TRACES = 10_000;

function pushBounded<T>(list: T[], value: T, max: number): void {
  if (list.includes(value)) return;
  list.push(value);
  if (list.length > max) list.shift();
}

export class ErrorAggregator {
  private readonly groups = new Map<string, ErrorGroup>();
  private readonly counted = new Map<string, string>();
  private readonly options: Required<ErrorAggregatorOptions>;

  constructor(options: ErrorAggregatorOptions = {}) {
    this.options = {
      maxGroups: options.maxGroups ?? 100,
      maxAffectedTraces: options.maxAffectedTraces ?? 10,
      maxAffectedSpans: options.maxAffectedSpans ?? 5,
    };
  }

  /**
   * Count a trace's failure, if it has one. Idempotent by trace id: call it
   * again with the merged trace as batches arrive. When a later batch changes
   * which group the trace belongs to (the throw site arrived after its 500),
   * the count moves.
   */
  addTrace(trace: TraceData): ErrorGroup | undefined {
    const occurrence = occurrenceFromTrace(
      trace.traceId,
      traceToIssueSpans(trace),
    );
    return occurrence ? this.add(occurrence) : undefined;
  }

  /** Count an error-level log outside any trace. */
  addLog(log: LogData): ErrorGroup | undefined {
    const occurrence = occurrenceFromLog(logToIssueLog(log));
    return occurrence ? this.add(occurrence) : undefined;
  }

  add(occurrence: Occurrence): ErrorGroup {
    const previous = this.counted.get(occurrence.id);
    if (previous === occurrence.fingerprint) {
      return this.groups.get(previous) ?? this.create(occurrence);
    }
    if (previous) {
      const old = this.groups.get(previous);
      if (old) {
        old.count -= 1;
        if (old.count <= 0) this.groups.delete(previous);
      }
    }
    this.counted.set(occurrence.id, occurrence.fingerprint);
    if (this.counted.size > MAX_REMEMBERED_TRACES) {
      this.counted.delete(this.counted.keys().next().value as string);
    }

    const group = this.groups.get(occurrence.fingerprint);
    if (!group) return this.create(occurrence);
    group.count += 1;
    // Batches arrive out of order: seen-times are bounds, not "latest write".
    group.firstSeen = Math.min(group.firstSeen, occurrence.timestamp);
    if (occurrence.timestamp >= group.lastSeen) {
      group.lastSeen = occurrence.timestamp;
      group.message = occurrence.message;
      if (occurrence.stack) group.stackTrace = trimStack(occurrence.stack);
    }
    if (occurrence.traceId) {
      pushBounded(
        group.affectedTraces,
        occurrence.traceId,
        this.options.maxAffectedTraces,
      );
    }
    if (occurrence.operation) {
      pushBounded(
        group.affectedSpans,
        occurrence.operation,
        this.options.maxAffectedSpans,
      );
    }
    return group;
  }

  private create(occurrence: Occurrence): ErrorGroup {
    if (this.groups.size >= this.options.maxGroups) this.evictOldest();
    const attributes = Object.fromEntries(
      Object.entries({
        'user.id': occurrence.userId,
        'account.id': occurrence.accountId,
        'session.id': occurrence.sessionId,
        'service.version': occurrence.version,
        'code.function': occurrence.culprit,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const group: ErrorGroup = {
      fingerprint: occurrence.fingerprint,
      source: occurrence.source,
      type: occurrence.type ?? DEFAULT_TYPE[occurrence.source],
      message: occurrence.message,
      stackTrace: occurrence.stack ? trimStack(occurrence.stack) : undefined,
      count: 1,
      firstSeen: occurrence.timestamp,
      lastSeen: occurrence.timestamp,
      affectedTraces: occurrence.traceId ? [occurrence.traceId] : [],
      affectedSpans: occurrence.operation ? [occurrence.operation] : [],
      service: occurrence.service,
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
    this.groups.set(occurrence.fingerprint, group);
    return group;
  }

  private evictOldest(): void {
    let oldest: ErrorGroup | undefined;
    for (const group of this.groups.values()) {
      if (!oldest || group.lastSeen < oldest.lastSeen) oldest = group;
    }
    if (oldest) this.groups.delete(oldest.fingerprint);
  }

  /** All groups, most recent first. */
  getErrorGroups(): ErrorGroup[] {
    return [...this.groups.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** All groups, most frequent first. */
  getErrorGroupsByFrequency(): ErrorGroup[] {
    return [...this.groups.values()].sort((a, b) => b.count - a.count);
  }

  getErrorGroup(fingerprint: string): ErrorGroup | undefined {
    return this.groups.get(fingerprint);
  }

  getErrorGroupsByService(service: string): ErrorGroup[] {
    return this.getErrorGroups().filter((g) => g.service === service);
  }

  getTotalErrorCount(): number {
    let total = 0;
    for (const group of this.groups.values()) total += group.count;
    return total;
  }

  getStats(): ErrorStats {
    const oneHourAgo = Date.now() - 3_600_000;
    let recentErrors = 0;
    const typeCount = new Map<string, number>();
    for (const group of this.groups.values()) {
      if (group.lastSeen > oneHourAgo) recentErrors += group.count;
      typeCount.set(group.type, (typeCount.get(group.type) ?? 0) + group.count);
    }
    return {
      totalGroups: this.groups.size,
      totalErrors: this.getTotalErrorCount(),
      recentErrors,
      topErrorTypes: [...typeCount.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  clear(): void {
    this.groups.clear();
    this.counted.clear();
  }

  /** Drop groups not seen within `maxAgeMs`. Returns how many went. */
  clearOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleared = 0;
    for (const [fingerprint, group] of this.groups) {
      if (group.lastSeen < cutoff) {
        this.groups.delete(fingerprint);
        cleared += 1;
      }
    }
    return cleared;
  }
}

/** Ten lines are enough to show where it threw; the issue store keeps it all. */
function trimStack(stack: string): string {
  return stack.split('\n').slice(0, 10).join('\n');
}
