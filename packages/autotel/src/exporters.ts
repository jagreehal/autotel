/**
 * OpenTelemetry Exporters
 *
 * Re-exports commonly-needed OpenTelemetry exporters for development and debugging.
 *
 * These exporters are already included in autotel's dependencies, so re-exporting
 * them provides a "one install is all you need" developer experience without any
 * bundle size impact.
 *
 * Use these for:
 * - Development debugging (see spans in console)
 * - Progressive development (verify instrumentation works)
 * - Example applications (demonstrate tracing)
 * - Testing (capture spans for assertions)
 *
 * @example Console debugging (development)
 * ```typescript
 * import { init } from 'autotel'
 * import { ConsoleSpanExporter } from 'autotel/exporters'
 *
 * init({
 *   service: 'my-app',
 *   spanExporter: new ConsoleSpanExporter(),
 * })
 * ```
 *
 * @example In-memory testing
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
 *
 * // Run code under test
 * await myFunction()
 *
 * // Assert on collected spans
 * const spans = exporter.getFinishedSpans()
 * expect(spans).toHaveLength(1)
 * ```
 *
 * Note: For high-level testing utilities with assertion helpers, see `autotel/testing`.
 * For custom span processing, see `autotel/processors`.
 *
 * @module autotel/exporters
 * @see {@link https://opentelemetry.io/docs/specs/otel/trace/sdk/#span-exporter | OTel Span Exporter Spec}
 */

export {
  /**
   * Console exporter - prints spans to stdout.
   *
   * Perfect for:
   * - Local development (see what's being traced)
   * - Example applications (demonstrate tracing)
   * - Quick debugging (no backend setup required)
   * - Progressive development (verify spans are created)
   *
   * Note: Not recommended for production use.
   *
   * @example
   * ```typescript
   * import { ConsoleSpanExporter } from 'autotel/exporters'
   *
   * const exporter = new ConsoleSpanExporter()
   * ```
   */
  ConsoleSpanExporter,

  /**
   * In-memory exporter - stores spans in memory.
   *
   * Perfect for:
   * - Unit testing (capture and assert on spans)
   * - Integration testing (verify trace structure)
   * - Development (inspect spans programmatically)
   *
   * Note: Memory will grow unbounded - clear spans periodically or use for testing only.
   *
   * @example
   * ```typescript
   * import { InMemorySpanExporter } from 'autotel/exporters'
   *
   * const exporter = new InMemorySpanExporter()
   * // ... run code
   * const spans = exporter.getFinishedSpans()
   * exporter.reset() // Clear memory
   * ```
   */
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
