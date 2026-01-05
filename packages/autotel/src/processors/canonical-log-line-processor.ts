/**
 * Canonical Log Line Processor
 *
 * Automatically emits spans as canonical log lines (wide events) when they end.
 * Implements Boris Tane's "canonical log line" pattern: one comprehensive
 * event per request with all context.
 *
 * When a span ends, this processor creates a log record with ALL span attributes,
 * making the span itself the canonical log line that can be queried like structured data.
 *
 * @example
 * ```typescript
 * import { init } from 'autotel';
 *
 * init({
 *   service: 'my-app',
 *   canonicalLogLines: {
 *     enabled: true,
 *     rootSpansOnly: true, // One canonical log line per request
 *   },
 * });
 * ```
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Attributes, AttributeValue } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { Logger } from '../logger';

/**
 * Function to redact sensitive attribute values
 */
export type AttributeRedactorFn = (
  key: string,
  value: AttributeValue,
) => AttributeValue;

export interface CanonicalLogLineOptions {
  /** Logger to use for emitting canonical log lines (defaults to OTel Logs API) */
  logger?: Logger;
  /** Only emit canonical log lines for root spans (default: false) */
  rootSpansOnly?: boolean;
  /** Minimum log level for canonical log lines (default: 'info') */
  minLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom message format (default: uses span name) */
  messageFormat?: (span: ReadableSpan) => string;
  /** Whether to include resource attributes (default: true) */
  includeResourceAttributes?: boolean;
  /**
   * Attribute redactor function to apply before logging.
   * This ensures sensitive data is redacted in canonical log lines,
   * matching the behavior of attributeRedactor in init().
   */
  attributeRedactor?: AttributeRedactorFn;
}

/**
 * Span processor that automatically emits spans as canonical log lines
 *
 * When a span ends, this processor creates a log record with ALL span attributes.
 * This implements the "canonical log line" pattern: one comprehensive event
 * per request with all context, queryable as structured data.
 *
 * **Key Benefits:**
 * - One log line per request with all context (wide event)
 * - High-cardinality, high-dimensionality data for powerful queries
 * - Automatic - no manual logging needed
 * - Works with any logger or OTel Logs API
 *
 * @example Basic usage
 * ```typescript
 * import { init } from 'autotel';
 *
 * init({
 *   service: 'checkout-api',
 *   canonicalLogLines: {
 *     enabled: true,
 *     rootSpansOnly: true, // One canonical log line per request
 *   },
 * });
 * ```
 *
 * @example With custom logger
 * ```typescript
 * import pino from 'pino';
 * import { init } from 'autotel';
 *
 * const logger = pino();
 * init({
 *   service: 'my-app',
 *   logger,
 *   canonicalLogLines: {
 *     enabled: true,
 *     logger, // Use Pino for canonical log lines
 *     rootSpansOnly: true,
 *   },
 * });
 * ```
 *
 * @example Custom message format
 * ```typescript
 * init({
 *   service: 'my-app',
 *   canonicalLogLines: {
 *     enabled: true,
 *     messageFormat: (span) => {
 *       const status = span.status.code === 2 ? 'ERROR' : 'SUCCESS';
 *       return `${span.name} [${status}]`;
 *     },
 *   },
 * });
 * ```
 */
export class CanonicalLogLineProcessor implements SpanProcessor {
  private logger?: Logger;
  private rootSpansOnly: boolean;
  private minLevel: 'debug' | 'info' | 'warn' | 'error';
  private messageFormat: (span: ReadableSpan) => string;
  private includeResourceAttributes: boolean;
  private attributeRedactor?: AttributeRedactorFn;
  private getOTelLogger: (() => ReturnType<typeof logs.getLogger>) | null =
    null;

  constructor(options: CanonicalLogLineOptions = {}) {
    this.logger = options.logger;
    this.rootSpansOnly = options.rootSpansOnly ?? false;
    this.minLevel = options.minLevel ?? 'info';
    this.messageFormat =
      options.messageFormat ?? ((span) => `[${span.name}] Request completed`);
    this.includeResourceAttributes = options.includeResourceAttributes ?? true;
    this.attributeRedactor = options.attributeRedactor;

    // Lazy-load OTel logger if no custom logger provided
    // We can't initialize it here because logs API might not be ready
    if (!this.logger) {
      this.getOTelLogger = () => logs.getLogger('autotel.canonical-log-line');
    }
  }

  onStart(): void {
    // No-op - we only care about span end
  }

  onEnd(span: ReadableSpan): void {
    // Skip if rootSpansOnly and this span has a LOCAL parent (same service)
    // We still emit for spans with REMOTE parents (from distributed tracing)
    // because those are the entry points ("roots") for THIS service.
    if (this.rootSpansOnly && span.parentSpanContext?.spanId) {
      // Check if parent is remote (from another service via traceparent/b3 headers)
      // If isRemote is true, this span is a service entry point and should emit
      // If isRemote is false/undefined, this is a local child span and should be skipped
      if (!span.parentSpanContext.isRemote) {
        return;
      }
    }

    // Determine log level from span status
    const level = this.getLogLevel(span);
    if (!this.shouldLog(level)) {
      return;
    }

    // Build canonical log line with ALL span attributes
    const canonicalLogLine = this.buildCanonicalLogLine(span);

    // Emit via logger or OTel Logs API
    if (this.logger) {
      this.emitViaLogger(level, span, canonicalLogLine);
    } else if (this.getOTelLogger) {
      const otelLogger = this.getOTelLogger();
      this.emitViaOTel(level, span, canonicalLogLine, otelLogger);
    }
  }

  private buildCanonicalLogLine(span: ReadableSpan): Record<string, unknown> {
    // Convert duration from [seconds, nanoseconds] to milliseconds
    // duration[0] is seconds, duration[1] is nanoseconds (fractional part)
    const durationMs = span.duration[0] * 1000 + span.duration[1] / 1_000_000;

    // Convert start time from [seconds, nanoseconds] to ISO string
    // startTime[0] is seconds, startTime[1] is nanoseconds (fractional part)
    const timestamp = new Date(
      span.startTime[0] * 1000 + span.startTime[1] / 1_000_000,
    ).toISOString();

    // Start with span attributes (potentially redacted)
    // We add these FIRST so core metadata fields below can't be overwritten
    const canonicalLogLine: Record<string, unknown> = {};

    // Apply redaction to span attributes if redactor is configured
    const attributes = this.redactAttributes(span.attributes);
    Object.assign(canonicalLogLine, attributes);

    // Include resource attributes (service-level context), also redacted
    if (this.includeResourceAttributes) {
      const resourceAttrs = this.redactAttributes(
        span.resource.attributes as Attributes,
      );
      Object.assign(canonicalLogLine, resourceAttrs);
    }

    // Set core metadata fields LAST to prevent span attributes from overwriting them
    // (e.g., if a span has an attribute named "traceId" or "timestamp")
    canonicalLogLine.operation = span.name;
    canonicalLogLine.traceId = span.spanContext().traceId;
    canonicalLogLine.spanId = span.spanContext().spanId;
    canonicalLogLine.correlationId = span.spanContext().traceId.slice(0, 16);
    canonicalLogLine.duration_ms = Math.round(durationMs * 100) / 100;
    canonicalLogLine.status_code = span.status.code;
    canonicalLogLine.status_message = span.status.message || undefined;
    canonicalLogLine.timestamp = timestamp;

    return canonicalLogLine;
  }

  /**
   * Apply attribute redaction if a redactor is configured
   */
  private redactAttributes(attributes: Attributes): Record<string, unknown> {
    if (!this.attributeRedactor) {
      // No redaction configured, return as-is
      return { ...attributes };
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        redacted[key] = this.attributeRedactor(key, value);
      }
    }
    return redacted;
  }

  private emitViaLogger(
    level: 'debug' | 'info' | 'warn' | 'error',
    span: ReadableSpan,
    canonicalLogLine: Record<string, unknown>,
  ): void {
    const message = this.messageFormat(span);
    if (level === 'error') {
      // Logger.error signature: (message, error?, extra?)
      this.logger!.error(message, undefined, canonicalLogLine);
    } else {
      this.logger![level](message, canonicalLogLine);
    }
  }

  private emitViaOTel(
    level: 'debug' | 'info' | 'warn' | 'error',
    span: ReadableSpan,
    canonicalLogLine: Record<string, unknown>,
    otelLogger: ReturnType<typeof logs.getLogger>,
  ): void {
    const message = this.messageFormat(span);
    // Convert unknown values to strings for OTel Logs API compatibility
    const otelAttributes: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(canonicalLogLine)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        otelAttributes[key] = value;
      } else if (value !== null && value !== undefined) {
        otelAttributes[key] = String(value);
      }
    }
    otelLogger.emit({
      severityNumber: this.getSeverityNumber(level),
      severityText: level.toUpperCase(),
      body: message,
      attributes: otelAttributes,
    });
  }

  private getLogLevel(span: ReadableSpan): 'debug' | 'info' | 'warn' | 'error' {
    // ERROR status code is 2
    if (span.status.code === 2) return 'error';

    // Could check for slow spans, etc. in the future
    // For now, default to info
    return 'info';
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private getSeverityNumber(level: string): SeverityNumber {
    const mapping: Record<string, SeverityNumber> = {
      debug: SeverityNumber.DEBUG,
      info: SeverityNumber.INFO,
      warn: SeverityNumber.WARN,
      error: SeverityNumber.ERROR,
    };
    return mapping[level] ?? SeverityNumber.INFO;
  }

  async forceFlush(): Promise<void> {
    // No-op - logging is fire-and-forget
  }

  async shutdown(): Promise<void> {
    // No-op - logging is fire-and-forget
  }
}
