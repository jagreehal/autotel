import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Logger } from './logger';
import type { CanonicalLogLineOptions } from './processors/canonical-log-line-processor';

/**
 * Emit completed spans as canonical wide-event logs.
 *
 * Each span (or only each root span) becomes one comprehensive log record with
 * all span attributes. This provides high-cardinality, structured events
 * without scattering logging calls throughout a request.
 *
 * @example One canonical log line per request
 * ```typescript
 * init({
 *   service: 'checkout-api',
 *   canonicalLogLines: {
 *     enabled: true,
 *     rootSpansOnly: true,
 *   },
 * });
 * ```
 *
 * @example Custom logger and message
 * ```typescript
 * const logger = pino();
 * init({
 *   service: 'checkout-api',
 *   logger,
 *   canonicalLogLines: {
 *     enabled: true,
 *     logger,
 *     messageFormat: (span) => {
 *       const status = span.status.code === 2 ? 'ERROR' : 'SUCCESS';
 *       return `${span.name} [${status}]`;
 *     },
 *   },
 * });
 * ```
 */
export interface CanonicalLogLinesConfig {
  enabled: boolean;
  /**
   * Logger(s) to emit canonical log lines through. Pass an array to fan out to
   * several. When omitted, lines go to the OTel Logs API instead.
   *
   * Note this falls back to the top-level `logger` on AutotelConfig, so
   * setting that alone also diverts canonical log lines away from OTLP.
   */
  logger?: Logger | Logger[];
  /**
   * Also emit through the OTel Logs API alongside any `logger`, so the same
   * lines reach an OTLP logs backend (Loki, and the like).
   *
   * Defaults to true only when no `logger` is given. Set `otel: true` with a
   * logger to get both: the platform's own log view keeps the lines, and OTLP
   * carries them to your backend.
   *
   * @example Console and Loki at once
   * ```typescript
   * init({
   *   endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
   *   canonicalLogLines: { enabled: true, logger: pino(), otel: true },
   * });
   * ```
   */
  otel?: boolean;
  /** Only emit canonical log lines for root spans (default: false). */
  rootSpansOnly?: boolean;
  /** Minimum log level for canonical log lines (default: 'info'). */
  minLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom message format (default: uses the span name). */
  messageFormat?: (span: ReadableSpan) => string;
  /** Whether to include resource attributes (default: true). */
  includeResourceAttributes?: boolean;
  /** Predicate to decide whether to emit (runs after the event is built). */
  shouldEmit?: CanonicalLogLineOptions['shouldEmit'];
  /**
   * Declarative tail sampling conditions (OR logic).
   * Ignored when `shouldEmit` is provided.
   * @example keep: [{ status: 500 }, { durationMs: 1000 }]
   */
  keep?: CanonicalLogLineOptions['keep'];
  /** Callback invoked after emit for custom fan-out. */
  drain?: CanonicalLogLineOptions['drain'];
  /** Handler for drain failures. */
  onDrainError?: CanonicalLogLineOptions['onDrainError'];
  /**
   * Pretty-print canonical log lines to console.
   * Defaults to true when NODE_ENV is 'development'.
   */
  pretty?: boolean;
}
