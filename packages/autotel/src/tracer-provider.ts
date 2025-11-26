/**
 * Isolated tracer provider support for Autotel
 *
 * Allows Autotel to use a separate TracerProvider instance, avoiding conflicts
 * with other OpenTelemetry instrumentation in the application.
 *
 * **Use Case:** Library authors who want to use Autotel without interfering
 * with the application's global OpenTelemetry setup.
 *
 * **Limitation:** While this isolates span processing and export, OpenTelemetry
 * context (trace IDs, parent spans) is still shared globally. Spans created with
 * the isolated provider may inherit trace context from global spans.
 */

import { trace } from '@opentelemetry/api';
import type { TracerProvider } from '@opentelemetry/api';

/**
 * Symbol for storing isolated tracer provider in global scope
 * Using Symbol.for() ensures the same symbol across module boundaries
 */
const AUTOLEMETRY_GLOBAL_SYMBOL = Symbol.for('autotel');

/**
 * Global state for Autotel
 */
type AutotelGlobalState = {
  isolatedTracerProvider: TracerProvider | null;
};

/**
 * Create initial state
 */
function createState(): AutotelGlobalState {
  return {
    isolatedTracerProvider: null,
  };
}

/**
 * Extend globalThis to include our symbol
 */
interface GlobalThis {
  [AUTOLEMETRY_GLOBAL_SYMBOL]?: AutotelGlobalState;
}

/**
 * Get the global state, creating it if it doesn't exist
 * Handles edge cases like missing globalThis
 */
function getGlobalState(): AutotelGlobalState {
  const initialState = createState();

  try {
    const g = globalThis as typeof globalThis & GlobalThis;

    if (typeof g !== 'object' || g === null) {
      console.warn(
        '[autotel] globalThis is not available, using fallback state',
      );
      return initialState;
    }

    if (!g[AUTOLEMETRY_GLOBAL_SYMBOL]) {
      Object.defineProperty(g, AUTOLEMETRY_GLOBAL_SYMBOL, {
        value: initialState,
        writable: false, // Lock the slot (not the contents)
        configurable: false,
        enumerable: false,
      });
    }

    return g[AUTOLEMETRY_GLOBAL_SYMBOL]!;
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `[autotel] Failed to access global state: ${error.message}`,
      );
    } else {
      console.error(
        `[autotel] Failed to access global state: ${String(error)}`,
      );
    }

    return initialState;
  }
}

/**
 * Sets an isolated TracerProvider for Autotel tracing operations.
 *
 * This allows Autotel to use its own TracerProvider instance, separate from
 * the global OpenTelemetry TracerProvider. This is useful for avoiding conflicts
 * with other OpenTelemetry instrumentation in the application.
 *
 * **Limitation: Span Context Sharing**
 *
 * While this function isolates span processing and export, it does NOT provide
 * complete trace isolation. OpenTelemetry context (trace IDs, parent spans) is
 * still shared between the global and isolated providers. This means:
 *
 * - Spans created with the isolated provider inherit trace IDs from global spans
 * - Spans created with the isolated provider inherit parent relationships from global spans
 * - This can result in spans from different providers being part of the same logical trace
 *
 * **Why this happens:**
 * OpenTelemetry uses a global context propagation mechanism that operates at the
 * JavaScript runtime level, independent of individual TracerProvider instances.
 * The context (containing trace ID, span ID) flows through async boundaries and
 * is inherited by all spans created within that context, regardless of which
 * TracerProvider creates them.
 *
 * **When to use this:**
 * - Library code that ships with embedded Autotel
 * - SDKs that want observability without requiring users to set up OpenTelemetry
 * - Applications that need separate span processing for different subsystems
 * - Testing scenarios where you want to isolate trace collection
 *
 * @param provider - The TracerProvider instance to use, or null to clear the isolated provider
 *
 * @example Library with embedded Autotel
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
 * import { setAutolem

etryTracerProvider } from 'autotel/tracer-provider'
 *
 * // Create provider with span processors in constructor
 * const exporter = new OTLPTraceExporter({
 *   url: 'https://your-backend.com/v1/traces'
 * })
 *
 * const provider = new NodeTracerProvider()
 * provider.addSpanProcessor(new BatchSpanProcessor(exporter))
 *
 * // Set as Autotel's isolated provider (doesn't call provider.register())
 * setAutotelTracerProvider(provider)
 *
 * // Now all Autotel trace() calls use this provider
 * // But won't interfere with the application's global OpenTelemetry setup
 * ```
 *
 * @example Testing with isolated provider
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
 * import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
 * import { setAutotelTracerProvider } from 'autotel/tracer-provider'
 *
 * // Test setup
 * const exporter = new InMemorySpanExporter()
 * const provider = new NodeTracerProvider()
 * provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
 *
 * setAutotelTracerProvider(provider)
 *
 * // Run tests...
 * const spans = exporter.getFinishedSpans()
 *
 * // Cleanup
 * setAutotelTracerProvider(null)
 * ```
 *
 * @example Multiple subsystems with different exporters
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
 * import { setAutotelTracerProvider } from 'autotel/tracer-provider'
 *
 * // Payment subsystem - send to payment team's backend
 * const paymentProvider = new NodeTracerProvider()
 * paymentProvider.addSpanProcessor(new BatchSpanProcessor(
 *   new OTLPTraceExporter({ url: 'https://payment-team-backend.com/v1/traces' })
 * ))
 *
 * // In payment module initialization
 * setAutotelTracerProvider(paymentProvider)
 * ```
 *
 * @public
 */
export function setAutotelTracerProvider(
  provider: TracerProvider | null,
): void {
  getGlobalState().isolatedTracerProvider = provider;
}

/**
 * Gets the TracerProvider for Autotel tracing operations.
 *
 * Returns the isolated TracerProvider if one has been set via setAutotelTracerProvider(),
 * otherwise falls back to the global OpenTelemetry TracerProvider.
 *
 * This function is used internally by Autotel's trace functions. Most users
 * will not need to call this directly.
 *
 * @returns The TracerProvider instance to use for Autotel tracing
 *
 * @example Getting the current provider
 * ```typescript
 * import { getAutotelTracerProvider } from 'autotel/tracer-provider'
 *
 * const provider = getAutotelTracerProvider()
 * const tracer = provider.getTracer('my-service', '1.0.0')
 * ```
 *
 * @example Checking if isolated provider is active
 * ```typescript
 * import { getAutotelTracerProvider, setAutotelTracerProvider } from 'autotel/tracer-provider'
 * import { trace } from '@opentelemetry/api'
 *
 * const currentProvider = getAutotelTracerProvider()
 * const globalProvider = trace.getTracerProvider()
 *
 * if (currentProvider === globalProvider) {
 *   console.log('Using global provider')
 * } else {
 *   console.log('Using isolated provider')
 * }
 * ```
 *
 * @public
 */
export function getAutotelTracerProvider(): TracerProvider {
  const { isolatedTracerProvider } = getGlobalState();

  if (isolatedTracerProvider) return isolatedTracerProvider;

  return trace.getTracerProvider();
}

/**
 * Gets the OpenTelemetry tracer instance for Autotel.
 *
 * This function returns a tracer specifically configured for Autotel
 * with the correct tracer name and version. Used internally by all
 * Autotel tracing functions to ensure consistent trace creation.
 *
 * Uses the isolated provider if set, otherwise uses the global provider.
 *
 * @param name - Tracer name (default: 'autotel')
 * @param version - Optional version string
 * @returns The Autotel OpenTelemetry tracer instance
 *
 * @example Basic usage
 * ```typescript
 * import { getAutotelTracer } from 'autotel/tracer-provider'
 *
 * const tracer = getAutotelTracer()
 * const span = tracer.startSpan('my-operation')
 * // ... use span
 * span.end()
 * ```
 *
 * @example Custom tracer name
 * ```typescript
 * import { getAutotelTracer } from 'autotel/tracer-provider'
 *
 * const tracer = getAutotelTracer('my-library', '2.1.0')
 * ```
 *
 * @public
 */
export function getAutotelTracer(name = 'autotel', version?: string) {
  return getAutotelTracerProvider().getTracer(name, version);
}
