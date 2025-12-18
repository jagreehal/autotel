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
 * @example Pretty console debugging (recommended)
 * ```typescript
 * import { init } from 'autotel'
 *
 * init({
 *   service: 'my-app',
 *   debug: 'pretty',  // Colorized, hierarchical output
 * })
 * ```
 *
 * @example Pretty exporter with custom options
 * ```typescript
 * import { init } from 'autotel'
 * import { PrettyConsoleExporter } from 'autotel/exporters'
 *
 * init({
 *   service: 'my-app',
 *   spanExporters: [new PrettyConsoleExporter({
 *     colors: true,
 *     showAttributes: true,
 *     hideAttributes: ['http.user_agent'],
 *   })],
 * })
 * ```
 *
 * @example Raw console debugging
 * ```typescript
 * import { init } from 'autotel'
 * import { ConsoleSpanExporter } from 'autotel/exporters'
 *
 * init({
 *   service: 'my-app',
 *   spanExporters: [new ConsoleSpanExporter()],
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
   * Console exporter - prints raw JSON spans to stdout.
   *
   * Perfect for:
   * - Verbose debugging (see all span details)
   * - Example applications (demonstrate tracing)
   * - Quick debugging (no backend setup required)
   *
   * Note: For better DX, use `debug: 'pretty'` or `PrettyConsoleExporter` instead.
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

/**
 * Pretty console exporter - colorized, hierarchical span output.
 *
 * Perfect for:
 * - Local development (beautiful, readable output)
 * - Debugging (see trace hierarchy at a glance)
 * - Progressive development (verify spans look correct)
 *
 * Features:
 * - Colorized status (✓ green, ✗ red)
 * - Duration color coding (fast=green, medium=yellow, slow=red)
 * - Hierarchical tree view showing parent-child relationships
 * - Attribute display with truncation
 * - Error message highlighting
 *
 * Note: Not recommended for production use.
 *
 * @example Basic usage
 * ```typescript
 * import { init } from 'autotel'
 *
 * init({
 *   service: 'my-app',
 *   debug: 'pretty',  // Uses PrettyConsoleExporter
 * })
 * ```
 *
 * @example With custom options
 * ```typescript
 * import { PrettyConsoleExporter } from 'autotel/exporters'
 *
 * const exporter = new PrettyConsoleExporter({
 *   colors: true,           // Auto-detect TTY by default
 *   showAttributes: true,   // Show span attributes
 *   maxValueLength: 50,     // Truncate long values
 *   hideAttributes: ['http.user_agent'],  // Hide specific attributes
 *   showTraceId: false,     // Show trace ID header
 * })
 * ```
 */
export {
  PrettyConsoleExporter,
  type PrettyConsoleExporterOptions,
} from './pretty-console-exporter';
