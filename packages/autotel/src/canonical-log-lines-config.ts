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
  /** Logger to use for emitting canonical log lines (defaults to OTel Logs API). */
  logger?: Logger;
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
