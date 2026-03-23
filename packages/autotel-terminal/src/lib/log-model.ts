/**
 * Log model utilities - pure logic for log grouping, filtering, and timelines.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log event format for terminal dashboard consumption.
 * Designed to align with Autotel canonical log lines / request-logger output.
 */
export interface TerminalLogEvent {
  /** Log timestamp in milliseconds since epoch */
  time: number;
  /** Log level */
  level: LogLevel;
  /** Short message */
  message: string;
  /** Optional trace correlation */
  traceId?: string;
  /** Optional span correlation */
  spanId?: string;
  /** Structured attributes / fields */
  attributes?: Record<string, unknown>;
}

/** Aggregate stats over logs */
export interface LogStats {
  total: number;
  errors: number;
}

/** Combined span/log timeline item for a single trace */
export type TimelineItemType = 'span' | 'log';

export interface TimelineItem<TSpan> {
  type: TimelineItemType;
  time: number;
  span?: TSpan;
  log?: TerminalLogEvent;
}

/**
 * Filter logs by search query and optional level threshold.
 * Search matches message and flattened stringified attributes.
 */
export function filterLogsBySearch(
  logs: TerminalLogEvent[],
  searchQuery: string,
  minLevel: LogLevel | null,
): TerminalLogEvent[] {
  let list = logs;

  if (minLevel) {
    const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const minIdx = order.indexOf(minLevel);
    list =
      minIdx === -1
        ? list
        : list.filter((log) => order.indexOf(log.level) >= minIdx);
  }

  if (searchQuery.trim() === '') return list;
  const q = searchQuery.toLowerCase();

  return list.filter((log) => {
    if (log.message.toLowerCase().includes(q)) return true;
    if (log.attributes) {
      for (const [k, v] of Object.entries(log.attributes)) {
        const s = `${k}:${String(v)}`.toLowerCase();
        if (s.includes(q)) return true;
      }
    }
    return false;
  });
}

/**
 * Compute simple aggregate stats over logs.
 */
export function computeLogStats(logs: TerminalLogEvent[]): LogStats {
  const total = logs.length;
  const errors = logs.filter((l) => l.level === 'error').length;
  return { total, errors };
}

/**
 * Build a combined span/log timeline for a single trace.
 * Spans must include { startTime, endTime }; logs are positioned by time.
 */
export function buildTraceTimeline<
  TSpan extends { startTime: number; endTime: number },
>(spans: TSpan[], logs: TerminalLogEvent[]): TimelineItem<TSpan>[] {
  const items: TimelineItem<TSpan>[] = [];

  for (const span of spans) {
    items.push({
      type: 'span',
      time: span.startTime,
      span,
    });
  }

  for (const log of logs) {
    items.push({
      type: 'log',
      time: log.time,
      log,
    });
  }

  items.sort((a, b) => a.time - b.time);
  return items;
}
