/**
 * Pretty Console Exporter
 *
 * A developer-friendly span exporter that displays colorized, hierarchical
 * trace output in the terminal. Zero external dependencies - uses ANSI escape codes.
 *
 * @example Basic usage
 * ```typescript
 * init({
 *   service: 'my-app',
 *   debug: 'pretty'  // Uses PrettyConsoleExporter
 * })
 * ```
 *
 * @example Explicit usage with options
 * ```typescript
 * import { PrettyConsoleExporter } from 'autotel/exporters'
 *
 * init({
 *   service: 'my-app',
 *   spanExporters: [new PrettyConsoleExporter({
 *     colors: true,
 *     showAttributes: true,
 *     hideAttributes: ['http.user_agent']
 *   })]
 * })
 * ```
 */

import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode } from '@opentelemetry/api';

/**
 * Export result code constants (avoid importing @opentelemetry/core)
 */
const ExportResultCode = {
  SUCCESS: 0,
  FAILED: 1,
} as const;

/**
 * Export result type for SpanExporter callback
 */
interface ExportResult {
  code: number;
  error?: Error;
}

/**
 * ANSI escape codes for terminal colors (zero dependencies)
 */
const ANSI = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  green: '\u001B[32m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  cyan: '\u001B[36m',
  gray: '\u001B[90m',
} as const;

type AnsiColor = keyof typeof ANSI;

/**
 * Configuration options for PrettyConsoleExporter
 */
export interface PrettyConsoleExporterOptions {
  /**
   * Enable ANSI colors in output
   * @default auto-detect TTY
   */
  colors?: boolean;

  /**
   * Show span attributes in output
   * @default true
   */
  showAttributes?: boolean;

  /**
   * Maximum length for attribute values before truncation
   * @default 50
   */
  maxValueLength?: number;

  /**
   * Show instrumentation scope name (e.g., [http], [pg])
   * @default true
   */
  showScope?: boolean;

  /**
   * Attribute keys to always hide from output
   * @default []
   */
  hideAttributes?: string[];

  /**
   * Show trace ID for each root span
   * @default false
   */
  showTraceId?: boolean;
}

/** Spans held across waiting traces; past this the oldest prints as it stands. */
const MAX_PENDING_SPANS = 10_000;

/**
 * A trace with no new span for this long prints as it stands. Its top span
 * may never arrive: a parent a `spanFilter` dropped is never exported.
 */
const IDLE_MS = 2000;

interface PendingTrace {
  spans: ReadableSpan[];
  lastSpanAt: number;
}

/**
 * Internal node structure for building span trees
 */
interface SpanNode {
  span: ReadableSpan;
  children: SpanNode[];
}

/**
 * Pretty Console Exporter - colorized, hierarchical span output for development
 *
 * Features:
 * - Colorized status indicators (✓ green, ✗ red)
 * - Duration with color coding (fast=green, medium=yellow, slow=red)
 * - Hierarchical tree view showing parent-child relationships
 * - Attribute display with truncation
 * - Error message highlighting
 */
export class PrettyConsoleExporter implements SpanExporter {
  private readonly options: Required<PrettyConsoleExporterOptions>;
  /** Ended spans by trace id, the trace touched least recently first. */
  private readonly pending = new Map<string, PendingTrace>();
  private pendingCount = 0;
  /** Span ids already printed, so a span that ends after them still prints. */
  private readonly printed = new Set<string>();
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(options: PrettyConsoleExporterOptions = {}) {
    this.options = {
      colors: options.colors ?? process.stdout?.isTTY ?? false,
      showAttributes: options.showAttributes ?? true,
      maxValueLength: options.maxValueLength ?? 50,
      showScope: options.showScope ?? true,
      hideAttributes: options.hideAttributes ?? [],
      showTraceId: options.showTraceId ?? false,
    };
  }

  /**
   * Buffer spans until their tree is whole, then print it.
   *
   * A `SimpleSpanProcessor` (what `debug: 'pretty'` uses) exports each span
   * alone as it ends, children first, and a batch can split a trace, so a
   * trace's tree is drawn when its top span arrives: a local root, or a span
   * ending after its parent was printed. Holding a span costs O(1); the tree
   * is only built when such a span arrives.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      const ready = new Set<string>();
      for (const span of spans) {
        const traceId = this.hold(span);
        if (this.isTop(span)) ready.add(traceId);
      }
      for (const traceId of ready) this.printTrace(traceId, false);
      while (this.pendingCount > MAX_PENDING_SPANS) {
        this.printTrace(this.pending.keys().next().value!, true);
      }
    } catch {
      // Fail-open: a formatting fault must not fail the export.
      this.pending.clear();
      this.pendingCount = 0;
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  /**
   * Print every trace that has had no new span for `IDLE_MS`. Exposed for
   * tests; the exporter runs it itself while anything is held.
   */
  sweep(now = Date.now()): void {
    for (const [traceId, trace] of this.pending) {
      if (now - trace.lastSpanAt < IDLE_MS) break;
      this.printTrace(traceId, true);
    }
    if (this.pending.size === 0) this.stopSweeper();
  }

  /** Hold `span` under its trace and return the trace id. */
  private hold(span: ReadableSpan): string {
    const traceId = span.spanContext().traceId;
    const trace = this.pending.get(traceId) ?? { spans: [], lastSpanAt: 0 };
    // Re-inserted so the map stays ordered by when each trace last grew.
    this.pending.delete(traceId);
    trace.spans.push(span);
    trace.lastSpanAt = Date.now();
    this.pending.set(traceId, trace);
    this.pendingCount++;
    this.startSweeper();
    return traceId;
  }

  /**
   * Print the trace's trees whose top span has arrived, or all of them when
   * `all` is set, and stop holding what was printed.
   */
  private printTrace(traceId: string, all: boolean): void {
    const trace = this.pending.get(traceId);
    if (!trace) return;
    const sorted = trace.spans.toSorted(
      (a, b) => hrTimeToMs(a.startTime) - hrTimeToMs(b.startTime),
    );
    const ready = this.buildSpanTree(sorted).filter(
      (node) => all || this.isTop(node.span),
    );
    if (ready.length === 0) return;

    if (this.options.showTraceId) {
      console.log(this.color(`trace: ${traceId}`, 'gray'));
    }
    const done = new Set<ReadableSpan>();
    for (const node of ready) {
      this.printNode(node, '', '');
      this.markPrinted(node, done);
    }
    // Blank line between traces
    console.log('');

    const rest = trace.spans.filter((span) => !done.has(span));
    this.pendingCount -= trace.spans.length - rest.length;
    if (rest.length > 0) trace.spans = rest;
    else this.pending.delete(traceId);
  }

  /** Nothing above this span is still coming. */
  private isTop(span: ReadableSpan): boolean {
    const parent = span.parentSpanContext;
    return (
      !parent || parent.isRemote === true || this.printed.has(parent.spanId)
    );
  }

  private markPrinted(node: SpanNode, done: Set<ReadableSpan>): void {
    done.add(node.span);
    this.printed.add(node.span.spanContext().spanId);
    if (this.printed.size > MAX_PENDING_SPANS) {
      this.printed.delete(this.printed.values().next().value!);
    }
    for (const child of node.children) this.markPrinted(child, done);
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      try {
        this.sweep();
      } catch {
        this.pending.clear();
        this.pendingCount = 0;
      }
    }, IDLE_MS / 2);
    this.sweeper.unref?.();
  }

  private stopSweeper(): void {
    clearInterval(this.sweeper);
    this.sweeper = undefined;
  }

  /**
   * Build a tree structure from flat spans using parent-child relationships
   */
  private buildSpanTree(spans: ReadableSpan[]): SpanNode[] {
    const spanMap = new Map<string, SpanNode>();
    const roots: SpanNode[] = [];

    // Create nodes for all spans
    for (const span of spans) {
      const spanId = span.spanContext().spanId;
      spanMap.set(spanId, { span, children: [] });
    }

    // Build parent-child relationships
    for (const span of spans) {
      const spanId = span.spanContext().spanId;
      const parentId = span.parentSpanContext?.spanId;
      const node = spanMap.get(spanId)!;

      if (parentId && spanMap.has(parentId)) {
        // Has parent in this batch - add as child
        spanMap.get(parentId)!.children.push(node);
      } else {
        // No parent or parent not in batch - treat as root
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Print a span node and its children. `prefix` is drawn before this span's
   * own line; `indent` before every line beneath it, carrying the `│` guide of
   * each ancestor that has more children to come.
   */
  private printNode(node: SpanNode, prefix: string, indent: string): void {
    const { span } = node;

    // Status indicator
    const isError = span.status.code === SpanStatusCode.ERROR;
    const statusChar = isError ? '✗' : '✓';
    const statusColor: AnsiColor = isError ? 'red' : 'green';

    // Duration formatting
    const durationMs = hrTimeToMs(span.duration);
    const durationStr = formatDuration(durationMs);
    const durationColor = getDurationColor(durationMs);

    // Scope name (instrumentation library)
    const scopeName = this.options.showScope
      ? this.color(` [${this.getScopeName(span)}]`, 'gray')
      : '';

    // Build the main line
    const line = [
      prefix,
      this.color(statusChar, statusColor),
      ' ',
      span.name.padEnd(Math.max(35 - prefix.length, 10)),
      this.color(durationStr.padStart(8), durationColor),
      scopeName,
    ].join('');

    console.log(line);

    // Detail lines sit under the span's name, inside its children's guide.
    const detailIndent =
      indent + (node.children.length > 0 ? '│ ' : '  ') + ' ';

    // Print attributes on next line (indented)
    if (this.options.showAttributes) {
      const attrs = this.formatAttributes(span);
      if (attrs) {
        console.log(this.color(`${detailIndent}${attrs}`, 'dim'));
      }
    }

    // Print error message if present
    if (isError && span.status.message) {
      console.log(
        this.color(`${detailIndent}Error: ${span.status.message}`, 'red'),
      );
    }

    // Print children
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      this.printNode(
        child,
        indent + (last ? '└─ ' : '├─ '),
        indent + (last ? '   ' : '│  '),
      );
    });
  }

  /**
   * Get short scope name from instrumentation scope
   */
  private getScopeName(span: ReadableSpan): string {
    const name = span.instrumentationScope?.name ?? 'unknown';
    // Extract short name from @opentelemetry/instrumentation-xxx format
    const match = name.match(/@opentelemetry\/instrumentation-(.+)/);
    if (match?.[1]) return match[1];
    // Fall back to last part of name or full name
    const lastPart = name.split('/').at(-1);
    return lastPart ?? name;
  }

  /**
   * Format span attributes as a comma-separated string
   */
  private formatAttributes(span: ReadableSpan): string {
    const attrs = span.attributes;
    if (!attrs || Object.keys(attrs).length === 0) {
      return '';
    }

    const pairs: string[] = [];
    for (const [key, value] of Object.entries(attrs)) {
      // Skip hidden attributes
      if (this.options.hideAttributes.includes(key)) continue;

      // Skip undefined/null values
      if (value === undefined || value === null) continue;

      // Format value
      const strValue = this.truncate(
        Array.isArray(value) ? `[${value.join(', ')}]` : String(value),
        this.options.maxValueLength,
      );
      pairs.push(`${key}=${strValue}`);
    }

    return pairs.join(', ');
  }

  /**
   * Truncate string to max length with ellipsis
   */
  private truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max - 3) + '...';
  }

  /**
   * Apply ANSI color if colors are enabled
   */
  private color(text: string, color: AnsiColor): string {
    if (!this.options.colors) return text;
    return `${ANSI[color]}${text}${ANSI.reset}`;
  }

  /** Print whatever is still held: nothing more is coming. */
  shutdown(): Promise<void> {
    const flushed = this.forceFlush();
    this.stopSweeper();
    return flushed;
  }

  /**
   * Print every held tree, finished or not. `flush()` is the caller asking
   * to see what has ended.
   */
  forceFlush(): Promise<void> {
    try {
      for (const traceId of this.pending.keys()) {
        this.printTrace(traceId, true);
      }
    } catch {
      this.pending.clear();
      this.pendingCount = 0;
    }
    return Promise.resolve();
  }
}

/**
 * Convert HrTime [seconds, nanoseconds] to milliseconds
 */
function hrTimeToMs(hrTime: [number, number]): number {
  const [seconds, nanos] = hrTime;
  return seconds * 1000 + nanos / 1_000_000;
}

/**
 * Format duration with appropriate units
 */
function formatDuration(ms: number): string {
  if (ms < 1) {
    // Sub-millisecond: show as microseconds
    return `${(ms * 1000).toFixed(0)}µs`;
  }
  if (ms < 1000) {
    // Under 1 second: show as milliseconds
    return `${ms.toFixed(0)}ms`;
  }
  // 1 second or more: show as seconds
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Get color based on duration (fast=green, medium=yellow, slow=red)
 */
function getDurationColor(ms: number): AnsiColor {
  if (ms < 100) return 'green';
  if (ms < 500) return 'yellow';
  return 'red';
}

/**
 * Export utility functions for testing
 */
export { formatDuration, getDurationColor, hrTimeToMs };
