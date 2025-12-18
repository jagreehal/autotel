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
   * Export spans with pretty formatting
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    try {
      // Group spans by trace ID
      const traceGroups = this.groupByTrace(spans);

      // Print each trace group
      for (const [traceId, traceSpans] of traceGroups) {
        this.printTrace(traceId, traceSpans);
      }

      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch {
      // Fail-open: don't crash the app if formatting fails
      resultCallback({ code: ExportResultCode.SUCCESS });
    }
  }

  /**
   * Group spans by their trace ID
   */
  private groupByTrace(spans: ReadableSpan[]): Map<string, ReadableSpan[]> {
    const groups = new Map<string, ReadableSpan[]>();

    for (const span of spans) {
      const traceId = span.spanContext().traceId;
      const group = groups.get(traceId) ?? [];
      group.push(span);
      groups.set(traceId, group);
    }

    return groups;
  }

  /**
   * Print a single trace with all its spans as a tree
   */
  private printTrace(traceId: string, spans: ReadableSpan[]): void {
    // Sort by start time
    const sorted = [...spans].toSorted((a, b) => {
      const aTime = hrTimeToMs(a.startTime);
      const bTime = hrTimeToMs(b.startTime);
      return aTime - bTime;
    });

    // Build tree structure
    const tree = this.buildSpanTree(sorted);

    // Print trace ID header if enabled
    if (this.options.showTraceId && tree.length > 0) {
      console.log(this.color(`trace: ${traceId}`, 'gray'));
    }

    // Print each root span and its children
    for (const node of tree) {
      this.printNode(node, 0, false);
    }

    // Add blank line between traces
    console.log('');
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
   * Print a span node with indentation and tree characters
   */
  private printNode(node: SpanNode, depth: number, isLast: boolean): void {
    const { span } = node;

    // Build tree prefix
    const prefix =
      depth === 0 ? '' : '  '.repeat(depth - 1) + (isLast ? '└─ ' : '├─ ');

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

    // Print attributes on next line (indented)
    if (this.options.showAttributes) {
      const attrs = this.formatAttributes(span);
      if (attrs) {
        const attrIndent = '  '.repeat(depth) + '     ';
        console.log(this.color(`${attrIndent}${attrs}`, 'dim'));
      }
    }

    // Print error message if present
    if (isError && span.status.message) {
      const errorIndent = '  '.repeat(depth) + '     ';
      console.log(
        this.color(`${errorIndent}Error: ${span.status.message}`, 'red'),
      );
    }

    // Print children
    const childCount = node.children.length;
    let index = 0;
    for (const child of node.children) {
      this.printNode(child, depth + 1, index === childCount - 1);
      index++;
    }
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

  /**
   * Shutdown (no-op for console exporter)
   */
  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Force flush (no-op for console exporter)
   */
  forceFlush(): Promise<void> {
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
