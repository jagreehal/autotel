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
import type { UnknownRecord } from '../values';
import { asBoolean, asNumber, asString, hasProcess, toError } from '../values';

/**
 * Function to redact sensitive attribute values
 */
export type AttributeRedactorFn = (
  key: string,
  value: AttributeValue,
) => AttributeValue;

const SEVERITY_NUMBERS = new Map<string, SeverityNumber>([
  ['debug', SeverityNumber.DEBUG],
  ['info', SeverityNumber.INFO],
  ['warn', SeverityNumber.WARN],
  ['error', SeverityNumber.ERROR],
]);

export interface CanonicalLogLineEvent {
  span: ReadableSpan;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  event: UnknownRecord;
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
  /**
   * Logger(s) to emit canonical log lines through. Pass an array to fan out to
   * several. When omitted, lines go to the OTel Logs API instead.
   */
  logger?: Logger | Logger[];
  /**
   * Also emit through the OTel Logs API (and so to an OTLP logs backend such
   * as Loki) alongside any `logger`.
   *
   * Defaults to true only when no `logger` is given, which is the historical
   * either/or behaviour. Set it explicitly to have both: a console/pino logger
   * keeps lines in the platform's own log view while OTLP carries the same
   * lines to your backend.
   */
  otel?: boolean;
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
  onDrainError?: (cause: unknown, ctx: CanonicalLogLineEvent) => void;
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
  private loggers: Logger[];
  private useOtel: boolean;
  private rootSpansOnly: boolean;
  private minLevel: 'debug' | 'info' | 'warn' | 'error';
  private messageFormat: (span: ReadableSpan) => string;
  private includeResourceAttributes: boolean;
  private attributeRedactor?: AttributeRedactorFn;
  private shouldEmit?: (ctx: CanonicalLogLineEvent) => boolean;
  private drain?: (ctx: CanonicalLogLineEvent) => void | Promise<void>;
  private onDrainError?: (cause: unknown, ctx: CanonicalLogLineEvent) => void;
  private pretty: boolean;
  private getOTelLogger: (() => ReturnType<typeof logs.getLogger>) | null =
    null;

  constructor(options: CanonicalLogLineOptions = {}) {
    this.loggers = options.logger
      ? Array.isArray(options.logger)
        ? options.logger.filter(Boolean)
        : [options.logger]
      : [];
    // Historical default: OTel only when nothing else is listening.
    this.useOtel = options.otel ?? this.loggers.length === 0;
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
      (hasProcess() && process.env.NODE_ENV === 'development');

    if (this.useOtel) {
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

    if (this.loggers.length > 0) {
      this.emitViaLogger(level, message, canonicalLogLine);
    }
    if (this.getOTelLogger) {
      try {
        const otelLogger = this.getOTelLogger();
        this.emitViaOTel(level, message, canonicalLogLine, otelLogger);
      } catch (error) {
        this.reportInternalWarning(
          'canonical log line OTel emission failed',
          error,
        );
      }
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

  private buildCanonicalLogLine(span: ReadableSpan): UnknownRecord {
    const durationMs = span.duration[0] * 1000 + span.duration[1] / 1_000_000;
    const timestamp = new Date(
      span.startTime[0] * 1000 + span.startTime[1] / 1_000_000,
    ).toISOString();

    // Span attributes first so core metadata fields below take precedence
    const canonicalLogLine: UnknownRecord = {};
    const attributes = this.redactAttributes(span.attributes);
    Object.assign(canonicalLogLine, attributes);

    if (this.includeResourceAttributes) {
      // SAFETY: a resource's attributes are span attributes by another name -
      // the SDK types them separately, the wire does not.
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

  private redactAttributes(attributes: Attributes): UnknownRecord {
    if (!this.attributeRedactor) {
      return { ...attributes };
    }

    const redacted: UnknownRecord = {};
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
    canonicalLogLine: UnknownRecord,
  ): void {
    for (const logger of this.loggers) {
      try {
        logger[level](canonicalLogLine, message);
      } catch (error) {
        // Destinations are independent. A broken stdout transport must not
        // prevent the next logger or the OTLP/Grafana path from receiving the
        // line, and a SpanProcessor must never throw into application code.
        this.reportInternalWarning(
          'canonical log line logger emission failed',
          error,
        );
      }
    }
  }

  private emitViaOTel(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    canonicalLogLine: UnknownRecord,
    otelLogger: ReturnType<typeof logs.getLogger>,
  ): void {
    const otelAttributes: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(canonicalLogLine)) {
      const scalar = asString(value) ?? asNumber(value) ?? asBoolean(value);
      if (scalar !== undefined) {
        otelAttributes[key] = scalar;
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
    return SEVERITY_NUMBERS.get(level) ?? SeverityNumber.INFO;
  }

  private reportInternalWarning(message: string, cause: unknown): void {
    const err = cause === undefined ? 'unknown error' : toError(cause).message;
    if (this.loggers.length > 0) {
      let reported = false;
      for (const logger of this.loggers) {
        try {
          logger.warn({ error: err }, `[autotel] ${message}`);
          reported = true;
        } catch {
          // Keep trying the remaining destinations.
        }
      }
      if (reported) return;
    }
    try {
      console.warn(`[autotel] ${message}: ${err}`);
    } catch {
      // Diagnostics must not make span completion fail either.
    }
  }

  async forceFlush(): Promise<void> {
    // No-op
  }

  async shutdown(): Promise<void> {
    // No-op
  }
}
