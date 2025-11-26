/**
 * OpenTelemetry Span Processors
 *
 * Re-exports commonly-needed OpenTelemetry span processors for custom configurations.
 *
 * These processors are already included in autotel's dependencies, so re-exporting
 * them provides a "one install is all you need" developer experience without any
 * bundle size impact.
 *
 * Use these when you need custom span processing logic beyond what `init()` provides.
 *
 * @example Simple processor (synchronous, for testing)
 * ```typescript
 * import { init } from 'autotel'
 * import { InMemorySpanExporter } from 'autotel/exporters'
 * import { SimpleSpanProcessor } from 'autotel/processors'
 *
 * const exporter = new InMemorySpanExporter()
 * init({
 *   service: 'test',
 *   spanProcessor: new SimpleSpanProcessor(exporter),
 * })
 * ```
 *
 * @example Batch processor (async batching, for production)
 * ```typescript
 * import { init } from 'autotel'
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
 * import { BatchSpanProcessor } from 'autotel/processors'
 *
 * const exporter = new OTLPTraceExporter({ url: 'http://collector:4318/v1/traces' })
 * init({
 *   service: 'my-app',
 *   spanProcessor: new BatchSpanProcessor(exporter, {
 *     maxQueueSize: 2048,
 *     scheduledDelayMillis: 5000,
 *     exportTimeoutMillis: 30000,
 *     maxExportBatchSize: 512,
 *   }),
 * })
 * ```
 *
 * Note: Most users don't need to use processors directly - `init()` configures
 * BatchSpanProcessor by default. Use these when you need custom processing logic.
 *
 * @module autotel/processors
 * @see {@link https://opentelemetry.io/docs/specs/otel/trace/sdk/#span-processor | OTel Span Processor Spec}
 */

export {
  /**
   * Simple span processor - processes spans synchronously.
   *
   * Perfect for:
   * - Unit testing (synchronous span export)
   * - Development (immediate span visibility)
   * - Debugging (no batching delays)
   *
   * How it works:
   * - Spans are exported immediately when they end
   * - No batching or queuing
   * - Blocking (export happens on the same thread)
   *
   * Warning: Not recommended for production - use BatchSpanProcessor instead.
   * SimpleSpanProcessor can impact performance in high-throughput scenarios.
   *
   * @example
   * ```typescript
   * import { SimpleSpanProcessor } from 'autotel/processors'
   * import { ConsoleSpanExporter } from 'autotel/exporters'
   *
   * const processor = new SimpleSpanProcessor(new ConsoleSpanExporter())
   * ```
   */
  SimpleSpanProcessor,

  /**
   * Batch span processor - batches spans before exporting.
   *
   * Perfect for:
   * - Production use (efficient, non-blocking)
   * - High-throughput applications
   * - Custom export configurations
   *
   * How it works:
   * - Spans are queued in memory
   * - Exported in batches at regular intervals
   * - Non-blocking (export happens on background thread)
   * - Configurable batch size, delay, queue size
   *
   * This is the default processor used by `init()`.
   *
   * @example Custom configuration
   * ```typescript
   * import { BatchSpanProcessor } from 'autotel/processors'
   *
   * const processor = new BatchSpanProcessor(exporter, {
   *   maxQueueSize: 4096,           // Max spans in queue
   *   scheduledDelayMillis: 10000,  // Export every 10s
   *   exportTimeoutMillis: 30000,   // 30s export timeout
   *   maxExportBatchSize: 1024,     // Max 1024 spans per batch
   * })
   * ```
   */
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
