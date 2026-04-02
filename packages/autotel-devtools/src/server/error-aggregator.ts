/**
 * Error Aggregator
 *
 * Groups similar errors together based on stack trace fingerprinting.
 * Tracks error frequency, first/last occurrence, and affected traces.
 *
 * @example
 * ```typescript
 * const aggregator = new ErrorAggregator({ maxGroups: 100 });
 *
 * // Add errors from spans
 * aggregator.addError({
 *   traceId: '123',
 *   spanId: '456',
 *   spanName: 'api.createUser',
 *   service: 'user-service',
 *   timestamp: Date.now(),
 *   error: {
 *     type: 'ValidationError',
 *     message: 'Invalid email format',
 *     stackTrace: 'Error: Invalid email...'
 *   }
 * });
 *
 * // Get aggregated error groups
 * const groups = aggregator.getErrorGroups();
 * ```
 */

import type { ErrorGroup, ErrorOccurrence, SpanData, TraceData } from './types';

export interface ErrorAggregatorOptions {
  /**
   * Maximum number of error groups to track (default: 100)
   * Oldest groups are evicted when limit is reached
   */
  maxGroups?: number;

  /**
   * Maximum number of affected traces to keep per group (default: 10)
   */
  maxAffectedTraces?: number;

  /**
   * Maximum number of affected span names to keep per group (default: 5)
   */
  maxAffectedSpans?: number;

  /**
   * Number of stack frames to use for fingerprinting (default: 5)
   */
  stackFramesForFingerprint?: number;
}

export class ErrorAggregator {
  private errorGroups: Map<string, ErrorGroup> = new Map();
  private options: Required<ErrorAggregatorOptions>;

  constructor(options: ErrorAggregatorOptions = {}) {
    this.options = {
      maxGroups: options.maxGroups ?? 100,
      maxAffectedTraces: options.maxAffectedTraces ?? 10,
      maxAffectedSpans: options.maxAffectedSpans ?? 5,
      stackFramesForFingerprint: options.stackFramesForFingerprint ?? 5,
    };
  }

  /**
   * Add an error occurrence to the aggregator
   */
  addError(occurrence: ErrorOccurrence): ErrorGroup {
    const fingerprint = this.generateFingerprint(occurrence);
    const existing = this.errorGroups.get(fingerprint);

    if (existing) {
      // Update existing group
      existing.count++;
      existing.lastSeen = occurrence.timestamp;

      // Add trace ID if not already present (keep last N)
      if (!existing.affectedTraces.includes(occurrence.traceId)) {
        existing.affectedTraces.push(occurrence.traceId);
        if (existing.affectedTraces.length > this.options.maxAffectedTraces) {
          existing.affectedTraces.shift();
        }
      }

      // Add span name if not already present
      if (!existing.affectedSpans.includes(occurrence.spanName)) {
        existing.affectedSpans.push(occurrence.spanName);
        if (existing.affectedSpans.length > this.options.maxAffectedSpans) {
          existing.affectedSpans.shift();
        }
      }

      return existing;
    }

    // Create new group
    const newGroup: ErrorGroup = {
      fingerprint,
      type: occurrence.error.type,
      message: occurrence.error.message,
      stackTrace: this.normalizeStackTrace(occurrence.error.stackTrace),
      count: 1,
      firstSeen: occurrence.timestamp,
      lastSeen: occurrence.timestamp,
      affectedTraces: [occurrence.traceId],
      affectedSpans: [occurrence.spanName],
      service: occurrence.service,
      attributes: occurrence.attributes,
    };

    // Evict oldest group if at capacity
    if (this.errorGroups.size >= this.options.maxGroups) {
      this.evictOldestGroup();
    }

    this.errorGroups.set(fingerprint, newGroup);
    return newGroup;
  }

  /**
   * Extract errors from a trace and add them to the aggregator
   */
  addErrorsFromTrace(trace: TraceData): ErrorGroup[] {
    const addedGroups: ErrorGroup[] = [];

    for (const span of trace.spans) {
      if (span.status.code === 'ERROR') {
        const occurrence = this.extractErrorFromSpan(span, trace);
        if (occurrence) {
          const group = this.addError(occurrence);
          addedGroups.push(group);
        }
      }
    }

    return addedGroups;
  }

  /**
   * Extract error occurrence from a span
   */
  private extractErrorFromSpan(
    span: SpanData,
    trace: TraceData,
  ): ErrorOccurrence | null {
    // Try to get error info from span attributes or events
    const exceptionEvent = span.events?.find((e) => e.name === 'exception');
    const errorType =
      (span.attributes['exception.type'] as string) ||
      (span.attributes['error.type'] as string) ||
      (exceptionEvent?.attributes?.['exception.type'] as string) ||
      'Error';

    const errorMessage =
      span.status.message ||
      (span.attributes['exception.message'] as string) ||
      (span.attributes['error.message'] as string) ||
      'Unknown error';

    const stackTrace =
      (span.attributes['exception.stacktrace'] as string) ||
      (span.attributes['exception.stack'] as string) ||
      this.extractStackFromEvents(span);

    return {
      traceId: trace.traceId,
      spanId: span.spanId,
      spanName: span.name,
      service: trace.service,
      timestamp: span.endTime,
      error: {
        type: errorType,
        message: errorMessage,
        stackTrace,
      },
      attributes: this.extractRelevantAttributes(span.attributes),
    };
  }

  /**
   * Extract stack trace from span events (exception events)
   */
  private extractStackFromEvents(span: SpanData): string | undefined {
    if (!span.events) return undefined;

    const exceptionEvent = span.events.find((e) => e.name === 'exception');
    if (exceptionEvent?.attributes) {
      return (
        (exceptionEvent.attributes['exception.stacktrace'] as string) ||
        (exceptionEvent.attributes['exception.stack'] as string)
      );
    }

    return undefined;
  }

  /**
   * Extract relevant attributes for error context
   */
  private extractRelevantAttributes(
    attributes: Record<string, unknown>,
  ): Record<string, unknown> {
    const relevant: Record<string, unknown> = {};
    const keepKeys = [
      'http.method',
      'http.url',
      'http.route',
      'http.status_code',
      'db.system',
      'db.operation',
      'rpc.method',
      'rpc.service',
      'code.function',
      'code.filepath',
      'user.id',
      'operation.name',
    ];

    for (const key of keepKeys) {
      if (key in attributes) {
        relevant[key] = attributes[key];
      }
    }

    return relevant;
  }

  /**
   * Generate a fingerprint for error grouping
   *
   * Uses error type + first N stack frames (normalized)
   */
  private generateFingerprint(occurrence: ErrorOccurrence): string {
    const parts: string[] = [occurrence.error.type];

    if (occurrence.error.stackTrace) {
      const frames = this.extractStackFrames(
        occurrence.error.stackTrace,
        this.options.stackFramesForFingerprint,
      );
      parts.push(...frames);
    } else {
      // Fallback to error message if no stack trace
      parts.push(this.normalizeMessage(occurrence.error.message));
    }

    // Simple hash function
    return this.simpleHash(parts.join('|'));
  }

  /**
   * Extract and normalize stack frames from a stack trace
   */
  private extractStackFrames(stackTrace: string, count: number): string[] {
    const lines = stackTrace.split('\n');
    const frames: string[] = [];

    for (const line of lines) {
      if (frames.length >= count) break;

      // Match common stack trace patterns
      const trimmed = line.trim();

      // Node.js style: "at functionName (file:line:col)"
      const nodeMatch = trimmed.match(/^at\s+(.+?)\s+\((.+?):(\d+):\d+\)$/);
      if (nodeMatch) {
        frames.push(`${nodeMatch[1]}@${this.normalizeFilePath(nodeMatch[2])}`);
        continue;
      }

      // Anonymous function style: "at file:line:col"
      const anonMatch = trimmed.match(/^at\s+(.+?):(\d+):\d+$/);
      if (anonMatch) {
        frames.push(`anonymous@${this.normalizeFilePath(anonMatch[1])}`);
        continue;
      }

      // Browser style: "functionName@file:line:col"
      const browserMatch = trimmed.match(/^(.+?)@(.+?):(\d+):\d+$/);
      if (browserMatch) {
        frames.push(
          `${browserMatch[1]}@${this.normalizeFilePath(browserMatch[2])}`,
        );
        continue;
      }
    }

    return frames;
  }

  /**
   * Normalize file path by removing absolute path prefixes and node_modules paths
   */
  private normalizeFilePath(filePath: string): string {
    // Remove node_modules paths (keep package name)
    const nodeModulesMatch = filePath.match(
      /node_modules\/(@[^/]+\/[^/]+|[^/]+)/,
    );
    if (nodeModulesMatch) {
      return `[npm]/${nodeModulesMatch[1]}`;
    }

    // Remove common absolute path prefixes
    return filePath
      .replace(/^.*?\/src\//, 'src/')
      .replace(/^.*?\/dist\//, 'dist/')
      .replace(/^.*?\/lib\//, 'lib/')
      .replace(/^file:\/\//, '');
  }

  /**
   * Normalize error message by removing dynamic parts
   */
  private normalizeMessage(message: string): string {
    return (
      message
        // Remove UUIDs
        .replaceAll(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
          '[UUID]',
        )
        // Remove hex IDs
        .replaceAll(/\b[0-9a-f]{16,}\b/gi, '[ID]')
        // Remove numbers
        .replaceAll(/\b\d+\b/g, '[N]')
        // Remove quoted strings
        .replaceAll(/"[^"]*"/g, '"[STR]"')
        .replaceAll(/'[^']*'/g, "'[STR]'")
        // Truncate long messages
        .slice(0, 200)
    );
  }

  /**
   * Normalize stack trace for display
   */
  private normalizeStackTrace(stackTrace?: string): string | undefined {
    if (!stackTrace) return undefined;

    const lines = stackTrace.split('\n').slice(0, 10); // Keep first 10 lines
    return lines.join('\n');
  }

  /**
   * Simple hash function for fingerprinting
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Evict the oldest error group
   */
  private evictOldestGroup(): void {
    let oldest: { fingerprint: string; lastSeen: number } | null = null;

    for (const [fingerprint, group] of this.errorGroups) {
      if (!oldest || group.lastSeen < oldest.lastSeen) {
        oldest = { fingerprint, lastSeen: group.lastSeen };
      }
    }

    if (oldest) {
      this.errorGroups.delete(oldest.fingerprint);
    }
  }

  /**
   * Get all error groups, sorted by most recent
   */
  getErrorGroups(): ErrorGroup[] {
    return [...this.errorGroups.values()].sort(
      (a, b) => b.lastSeen - a.lastSeen,
    );
  }

  /**
   * Get error groups sorted by count (most frequent first)
   */
  getErrorGroupsByFrequency(): ErrorGroup[] {
    return [...this.errorGroups.values()].sort(
      (a, b) => b.count - a.count,
    );
  }

  /**
   * Get a specific error group by fingerprint
   */
  getErrorGroup(fingerprint: string): ErrorGroup | undefined {
    return this.errorGroups.get(fingerprint);
  }

  /**
   * Get error groups for a specific service
   */
  getErrorGroupsByService(service: string): ErrorGroup[] {
    return this.getErrorGroups().filter((g) => g.service === service);
  }

  /**
   * Get total error count across all groups
   */
  getTotalErrorCount(): number {
    let total = 0;
    for (const group of this.errorGroups.values()) {
      total += group.count;
    }
    return total;
  }

  /**
   * Get error statistics
   */
  getStats(): {
    totalGroups: number;
    totalErrors: number;
    recentErrors: number;
    topErrorTypes: Array<{ type: string; count: number }>;
  } {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    let recentErrors = 0;
    const typeCount = new Map<string, number>();

    for (const group of this.errorGroups.values()) {
      if (group.lastSeen > oneHourAgo) {
        recentErrors += group.count;
      }
      typeCount.set(group.type, (typeCount.get(group.type) || 0) + group.count);
    }

    const topErrorTypes = [...typeCount.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalGroups: this.errorGroups.size,
      totalErrors: this.getTotalErrorCount(),
      recentErrors,
      topErrorTypes,
    };
  }

  /**
   * Clear all error groups
   */
  clear(): void {
    this.errorGroups.clear();
  }

  /**
   * Clear old error groups (not seen in given time window)
   */
  clearOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleared = 0;

    for (const [fingerprint, group] of this.errorGroups) {
      if (group.lastSeen < cutoff) {
        this.errorGroups.delete(fingerprint);
        cleared++;
      }
    }

    return cleared;
  }
}
