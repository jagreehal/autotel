/**
 * Canonical Log Line Processor
 *
 * Automatically emits spans as canonical log lines (wide events) when they end.
 * Implements canonical log line" pattern: one comprehensive
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
import { formatPrettyLogLine, formatDuration } from '../pretty-log-formatter';

/**
 * Function to redact sensitive attribute values
 */
export type AttributeRedactorFn = (
  key: string,
  value: AttributeValue,
) => AttributeValue;

export interface CanonicalLogLineEvent {
  span: ReadableSpan;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  event: Record<string, unknown>;
}

export interface KeepCondition {
  /** Keep events where HTTP status >= this value. */
  status?: number;
  /** Keep events where duration_ms >= this value. */
  durationMs?: number;
  /** Keep events matching this path pattern (simple prefix match). */
  path?: string;
}

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
  /** Predicate to decide whether to emit (runs after event is built). */
  shouldEmit?: (ctx: CanonicalLogLineEvent) => boolean;
  /**
   * Declarative tail sampling conditions (OR logic). If any condition matches,
   * the event is kept. Ignored when `shouldEmit` is provided.
   *
   * @example
   * keep: [{ status: 500 }, { durationMs: 1000 }]
   */
  keep?: KeepCondition[];
  /** Callback invoked after emit for custom fan-out. */
  drain?: (ctx: CanonicalLogLineEvent) => void | Promise<void>;
  /** Handler for drain failures. */
  onDrainError?: (error: unknown, ctx: CanonicalLogLineEvent) => void;
  /**
   * Pretty-print canonical log lines to console in a tree format.
   * Defaults to true when NODE_ENV is 'development'.
   */
  pretty?: boolean;
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
  private shouldEmit?: (ctx: CanonicalLogLineEvent) => boolean;
  private drain?: (ctx: CanonicalLogLineEvent) => void | Promise<void>;
  private onDrainError?: (error: unknown, ctx: CanonicalLogLineEvent) => void;
  private pretty: boolean;
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
    this.shouldEmit =
      options.shouldEmit ?? this.buildKeepPredicate(options.keep);
    this.drain = options.drain;
    this.onDrainError = options.onDrainError;
    this.pretty =
      options.pretty ??
      (typeof process !== 'undefined' &&
        process.env.NODE_ENV === 'development');

    if (!this.logger) {
      this.getOTelLogger = () => logs.getLogger('autotel.canonical-log-line');
    }
  }

  private buildKeepPredicate(
    keep?: KeepCondition[],
  ): ((ctx: CanonicalLogLineEvent) => boolean) | undefined {
    if (!keep || keep.length === 0) return undefined;

    return (ctx: CanonicalLogLineEvent) => {
      return keep.some((condition) => {
        if (condition.status !== undefined) {
          const httpStatus = Number(
            ctx.event['http.response.status_code'] ?? 0,
          );
          if (httpStatus >= condition.status) return true;
        }
        if (
          condition.durationMs !== undefined &&
          Number(ctx.event.duration_ms ?? 0) >= condition.durationMs
        ) {
          return true;
        }
        if (condition.path !== undefined) {
          const route = String(
            ctx.event['http.route'] ?? ctx.event['url.path'] ?? '',
          );
          if (route.startsWith(condition.path)) return true;
        }
        return false;
      });
    };
  }

  onStart(): void {
    // No-op
  }

  onEnd(span: ReadableSpan): void {
    if (
      this.rootSpansOnly &&
      span.parentSpanContext?.spanId &&
      !span.parentSpanContext.isRemote
    ) {
      return;
    }

    const level = this.getLogLevel(span);
    if (!this.shouldLog(level)) {
      return;
    }

    const canonicalLogLine = this.buildCanonicalLogLine(span);
    const message = this.messageFormat(span);
    const eventContext: CanonicalLogLineEvent = {
      span,
      level,
      message,
      event: canonicalLogLine,
    };

    if (this.shouldEmit && !this.shouldEmit(eventContext)) return;

    if (this.pretty) {
      console.log(formatPrettyLogLine(eventContext));
    }

    if (this.logger) {
      this.emitViaLogger(level, message, canonicalLogLine);
    } else if (this.getOTelLogger) {
      const otelLogger = this.getOTelLogger();
      this.emitViaOTel(level, message, canonicalLogLine, otelLogger);
    }

    if (this.drain) {
      Promise.resolve(this.drain(eventContext)).catch((error) => {
        if (this.onDrainError) {
          this.onDrainError(error, eventContext);
          return;
        }
        this.reportInternalWarning('canonicalLogLines.drain failed', error);
      });
    }
  }

  private buildCanonicalLogLine(span: ReadableSpan): Record<string, unknown> {
    const durationMs = span.duration[0] * 1000 + span.duration[1] / 1_000_000;
    const timestamp = new Date(
      span.startTime[0] * 1000 + span.startTime[1] / 1_000_000,
    ).toISOString();

    // Span attributes first so core metadata fields below take precedence
    const canonicalLogLine: Record<string, unknown> = {};
    const attributes = this.redactAttributes(span.attributes);
    Object.assign(canonicalLogLine, attributes);

    if (this.includeResourceAttributes) {
      const resourceAttrs = this.redactAttributes(
        span.resource.attributes as Attributes,
      );
      Object.assign(canonicalLogLine, resourceAttrs);
    }

    canonicalLogLine.operation = span.name;
    canonicalLogLine.traceId = span.spanContext().traceId;
    canonicalLogLine.spanId = span.spanContext().spanId;
    canonicalLogLine.correlationId = span.spanContext().traceId.slice(0, 16);
    canonicalLogLine.duration_ms = Math.round(durationMs * 100) / 100;
    canonicalLogLine.duration = formatDuration(durationMs);
    canonicalLogLine.status_code = span.status.code;
    canonicalLogLine.status_message = span.status.message || undefined;
    canonicalLogLine.timestamp = timestamp;

    return canonicalLogLine;
  }

  private redactAttributes(attributes: Attributes): Record<string, unknown> {
    if (!this.attributeRedactor) {
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
    message: string,
    canonicalLogLine: Record<string, unknown>,
  ): void {
    this.logger![level](canonicalLogLine, message);
  }

  private emitViaOTel(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    canonicalLogLine: Record<string, unknown>,
    otelLogger: ReturnType<typeof logs.getLogger>,
  ): void {
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
    const explicitLevel = span.attributes['autotel.log.level'];
    if (
      explicitLevel === 'debug' ||
      explicitLevel === 'info' ||
      explicitLevel === 'warn' ||
      explicitLevel === 'error'
    ) {
      return explicitLevel;
    }

    if (span.status.code === 2) return 'error';
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

  private reportInternalWarning(message: string, error: unknown): void {
    const err =
      error instanceof Error ? error.message : String(error ?? 'unknown error');
    if (this.logger) {
      this.logger.warn({ error: err }, `[autotel] ${message}`);
      return;
    }
    console.warn(`[autotel] ${message}: ${err}`);
  }

  async forceFlush(): Promise<void> {
    // No-op
  }

  async shutdown(): Promise<void> {
    // No-op
  }
}
