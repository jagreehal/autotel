/**
 * Trace context helpers - Core primitives for trace correlation
 *
 * These are the building blocks that allow users to bring their own logger
 * (bunyan, log4js, custom, etc.) and add trace correlation.
 *
 * @example Using with bunyan
 * ```typescript
 * import bunyan from 'bunyan';
 * import { enrichWithTraceContext } from 'autotel/trace-helpers';
 *
 * const bunyanLogger = bunyan.createLogger({ name: 'myapp' });
 *
 * const logger = {
 *   info: (msg: string, extra?: object) => {
 *     bunyanLogger.info(enrichWithTraceContext(extra || {}), msg);
 *   }
 * };
 * ```
 *
 * @example Using with log4js
 * ```typescript
 * import log4js from 'log4js';
 * import { getTraceContext } from 'autotel/trace-helpers';
 *
 * const log4jsLogger = log4js.getLogger();
 *
 * function logWithTrace(level: string, msg: string, extra?: object) {
 *   const context = getTraceContext();
 *   log4jsLogger[level](msg, { ...extra, ...context });
 * }
 * ```
 */

import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import type { Span, Tracer, Context } from '@opentelemetry/api';

/**
 * WeakMap to store span names for active spans
 * This allows us to retrieve the span name even though OpenTelemetry
 * doesn't expose it through the public API
 */
const spanNameMap = new WeakMap<Span, string>();

/**
 * Store span name for a given span
 * Called internally when spans are created
 */
export function setSpanName(span: Span, name: string): void {
  spanNameMap.set(span, name);
}

/**
 * Trace context extracted from active span
 */
export interface TraceContext {
  /** Full 32-character hex trace ID */
  traceId: string;
  /** 16-character hex span ID */
  spanId: string;
  /** First 16 characters of trace ID (for log grouping/correlation) */
  correlationId: string;
  /** Function/operation name (OpenTelemetry semantic convention: code.function) */
  'code.function'?: string;
  /** Datadog trace ID in decimal format (lower 64 bits) for log-trace correlation */
  'dd.trace_id'?: string;
  /** Datadog span ID in decimal format for log-trace correlation */
  'dd.span_id'?: string;
}

/**
 * Convert hex string to decimal string representation
 * Handles 64-bit unsigned integers for Datadog correlation
 *
 * @param hex - Hex string (up to 16 characters for 64-bit)
 * @returns Decimal string representation
 */
function hexToDecimal(hex: string): string {
  // For 64-bit values, use BigInt to avoid precision loss
  return BigInt('0x' + hex).toString(10);
}

/**
 * Get current trace context from active span
 *
 * Returns null if no span is active (e.g., outside of trace operation)
 *
 * Includes both OpenTelemetry standard fields (hex) and Datadog-specific
 * fields (decimal) for maximum compatibility.
 *
 * @returns Trace context with traceId, spanId, correlationId, and Datadog decimal IDs, or null
 *
 * @example
 * ```typescript
 * import { getTraceContext } from 'autotel/trace-helpers';
 *
 * const context = getTraceContext();
 * if (context) {
 *   console.log('Current trace:', context.traceId);
 *   // Current trace: 4bf92f3577b34da6a3ce929d0e0e4736
 *   console.log('Datadog trace ID:', context['dd.trace_id']);
 *   // Datadog trace ID: 12007117331170166582 (decimal for log correlation)
 * }
 * ```
 */
export function getTraceContext(): TraceContext | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const spanContext = span.spanContext();
  const traceId = spanContext.traceId;
  const spanId = spanContext.spanId;

  // Get span name from WeakMap (set when span is created)
  // Map to OpenTelemetry semantic convention: code.function
  const spanName = spanNameMap.get(span);

  // Datadog uses the lower 64 bits of the 128-bit OpenTelemetry trace ID
  // Convert from hex to decimal for Datadog's log-trace correlation
  const traceIdLower64 = traceId.slice(-16); // Last 16 hex chars = lower 64 bits
  const ddTraceId = hexToDecimal(traceIdLower64);
  const ddSpanId = hexToDecimal(spanId);

  return {
    traceId,
    spanId,
    correlationId: traceId.slice(0, 16),
    ...(spanName && { 'code.function': spanName }),
    // Datadog-specific fields for log-trace correlation
    'dd.trace_id': ddTraceId,
    'dd.span_id': ddSpanId,
  };
}

/**
 * Enrich object with trace context (traceId, spanId, correlationId, and Datadog fields)
 *
 * If no span is active, returns the object unchanged.
 * This prevents "undefined" or "null" values in logs.
 *
 * Automatically adds both OpenTelemetry standard fields (hex) and Datadog-specific
 * fields (decimal) for maximum compatibility with observability backends.
 *
 * @param obj - Object to enrich (e.g., log metadata)
 * @returns Object with trace context merged in, or unchanged if no active span
 *
 * @example
 * ```typescript
 * import { enrichWithTraceContext } from 'autotel/trace-helpers';
 *
 * // Inside a trace operation:
 * const enriched = enrichWithTraceContext({ userId: '123' });
 * // {
 * //   userId: '123',
 * //   traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
 * //   spanId: '00f067aa0ba902b7',
 * //   correlationId: '4bf92f3577b34da6',
 * //   'dd.trace_id': '12007117331170166582',  // Datadog decimal format
 * //   'dd.span_id': '67667974448284583'       // Datadog decimal format
 * // }
 *
 * // Outside trace operation:
 * const unchanged = enrichWithTraceContext({ userId: '123' });
 * // { userId: '123' } - no trace fields added
 * ```
 */
export function enrichWithTraceContext<T extends Record<string, unknown>>(
  obj: T,
): T {
  const context = getTraceContext();
  return context ? ({ ...obj, ...context } as T) : obj;
}

/**
 * Check if currently in a trace context
 *
 * Useful for conditional logic based on trace presence
 *
 * @returns true if active span exists, false otherwise
 *
 * @example
 * ```typescript
 * import { isTracing } from 'autotel/trace-helpers';
 *
 * if (isTracing()) {
 *   // Add expensive debug metadata only when tracing
 *   logger.debug('Detailed context', expensiveDebugData());
 * }
 * ```
 */
export function isTracing(): boolean {
  return trace.getActiveSpan() !== undefined;
}

/**
 * Get a tracer instance for creating custom spans
 *
 * Use this when you need low-level control over span lifecycle.
 * For most use cases, prefer trace(), span(), or instrument() instead.
 *
 * @param name - Tracer name (usually your service or module name)
 * @param version - Optional version string
 * @returns OpenTelemetry Tracer instance
 *
 * @example Basic usage
 * ```typescript
 * import { getTracer } from 'autotel';
 *
 * const tracer = getTracer('my-service');
 * const span = tracer.startSpan('custom.operation');
 * try {
 *   // Your logic
 *   span.setAttribute('key', 'value');
 * } finally {
 *   span.end();
 * }
 * ```
 *
 * @example With AI SDK
 * ```typescript
 * import { getTracer } from 'autotel';
 * import { generateText } from 'ai';
 *
 * const tracer = getTracer('ai-agent');
 * const result = await generateText({
 *   model: myModel,
 *   prompt: 'Hello',
 *   experimental_telemetry: {
 *     isEnabled: true,
 *     tracer,
 *   },
 * });
 * ```
 */
export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

/**
 * Get the currently active span
 *
 * Returns undefined if no span is currently active.
 * Useful for adding attributes or events to the current span.
 *
 * @returns Active span or undefined
 *
 * @example Adding attributes to active span
 * ```typescript
 * import { getActiveSpan } from 'autotel';
 *
 * const span = getActiveSpan();
 * if (span) {
 *   span.setAttribute('user.id', userId);
 *   span.addEvent('User action', { action: 'click' });
 * }
 * ```
 *
 * @example Checking span status
 * ```typescript
 * import { getActiveSpan, SpanStatusCode } from 'autotel';
 *
 * const span = getActiveSpan();
 * if (span?.isRecording()) {
 *   span.setStatus({ code: SpanStatusCode.OK });
 * }
 * ```
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Get the currently active OpenTelemetry context
 *
 * The context contains the active span and any baggage.
 * Useful for context propagation and custom instrumentation.
 *
 * @returns Current active context
 *
 * @example Propagating context
 * ```typescript
 * import { getActiveContext } from 'autotel';
 *
 * const currentContext = getActiveContext();
 * // Pass context to another function or service
 * ```
 *
 * @example With context injection
 * ```typescript
 * import { getActiveContext, injectTraceContext } from 'autotel';
 *
 * const headers = {};
 * injectTraceContext(headers);
 * // Headers now contain trace propagation data
 * ```
 */
export function getActiveContext(): Context {
  // Check stored context first (from baggage setters), then fall back to active context
  // This ensures ctx.setBaggage() changes are visible to OpenTelemetry operations
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getActiveContextWithBaggage } = require('./trace-context');
    return getActiveContextWithBaggage();
  } catch {
    // Fallback if trace-context isn't available
    return context.active();
  }
}

/**
 * Run a function with a specific span set as active
 *
 * This is a convenience wrapper around the two-step process of
 * setting a span in context and running code within that context.
 *
 * @param span - The span to set as active
 * @param fn - Function to execute with the span active
 * @returns The return value of the function
 *
 * @example Running code with a custom span
 * ```typescript
 * import { getTracer, runWithSpan } from 'autotel';
 *
 * const tracer = getTracer('my-service');
 * const span = tracer.startSpan('background.job');
 *
 * try {
 *   const result = await runWithSpan(span, async () => {
 *     // Any spans created here will be children of 'background.job'
 *     await processData();
 *     return { success: true };
 *   });
 *   console.log(result);
 * } finally {
 *   span.end();
 * }
 * ```
 *
 * @example Testing with custom spans
 * ```typescript
 * import { runWithSpan, otelTrace } from 'autotel';
 *
 * const tracer = otelTrace.getTracer('test');
 * const span = tracer.startSpan('test.operation');
 *
 * const result = runWithSpan(span, () => {
 *   // Code under test runs with this span as active
 *   return myFunction();
 * });
 *
 * span.end();
 * ```
 */
export function runWithSpan<T>(span: Span, fn: () => T): T {
  const ctx = trace.setSpan(context.active(), span);
  return context.with(ctx, fn);
}

/**
 * Finalize a span with appropriate status and optional error recording
 *
 * This is a convenience function that:
 * - Records exceptions if an error is provided
 * - Sets span status to ERROR if error exists, OK otherwise
 * - Ends the span
 *
 * @param span - The span to finalize
 * @param error - Optional error to record
 *
 * @example Without error (success case)
 * ```typescript
 * import { getTracer, finalizeSpan } from 'autotel';
 *
 * const tracer = getTracer('my-service');
 * const span = tracer.startSpan('operation');
 *
 * try {
 *   await doWork();
 *   finalizeSpan(span);
 * } catch (error) {
 *   finalizeSpan(span, error);
 *   throw error;
 * }
 * ```
 *
 * @example With error
 * ```typescript
 * import { getTracer, finalizeSpan } from 'autotel';
 *
 * const tracer = getTracer('my-service');
 * const span = tracer.startSpan('operation');
 *
 * try {
 *   await riskyOperation();
 *   finalizeSpan(span);
 * } catch (error) {
 *   finalizeSpan(span, error); // Records exception and sets ERROR status
 *   throw error;
 * }
 * ```
 *
 * @example In instrumentation
 * ```typescript
 * import { getTracer, runWithSpan, finalizeSpan } from 'autotel';
 *
 * function instrumentedQuery(query: string) {
 *   const tracer = getTracer('db');
 *   const span = tracer.startSpan('db.query');
 *
 *   return runWithSpan(span, () => {
 *     try {
 *       const result = executeQuery(query);
 *       finalizeSpan(span);
 *       return result;
 *     } catch (error) {
 *       finalizeSpan(span, error);
 *       throw error;
 *     }
 *   });
 * }
 * ```
 */
export function finalizeSpan(span: Span, error?: unknown): void {
  if (error) {
    if (error instanceof Error) {
      span.recordException(error);
    } else {
      span.recordException(new Error(String(error)));
    }
    span.setStatus({ code: SpanStatusCode.ERROR });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

/**
 * Creates a deterministic trace ID from a seed string.
 *
 * Generates a consistent 128-bit trace ID (32 hex characters) from an input seed
 * using SHA-256 hashing. Useful for correlating external system IDs (request IDs,
 * order IDs, session IDs) with OpenTelemetry trace IDs.
 *
 * **Use Cases:**
 * - Correlate external request IDs with traces
 * - Link customer support tickets to trace data
 * - Associate business entities (orders, sessions) with observability data
 * - Debug specific user flows by deterministic trace lookup
 *
 * **Important:** Only use this when you need deterministic trace IDs for correlation.
 * For normal tracing, let OpenTelemetry generate random trace IDs automatically.
 *
 * **Runtime Support:**
 * - Node.js 15+ (native crypto.subtle)
 * - All modern browsers
 * - Edge runtimes (Cloudflare Workers, Deno, etc.)
 *
 * @param seed - Input string to generate trace ID from (e.g., request ID, order ID)
 * @returns Promise resolving to a 32-character hex trace ID (128 bits)
 *
 * @example Correlate external request ID with trace
 * ```typescript
 * import { createDeterministicTraceId } from 'autotel/trace-helpers'
 * import { trace, context } from '@opentelemetry/api'
 *
 * // In middleware or request handler
 * const requestId = req.headers['x-request-id']
 * const traceId = await createDeterministicTraceId(requestId)
 *
 * // Use with manual span creation (advanced - not needed with trace/span functions)
 * const tracer = trace.getTracer('my-service')
 * const spanContext = {
 *   traceId,
 *   spanId: '0123456789abcdef', // Still random
 *   traceFlags: 1
 * }
 * ```
 *
 * @example Link customer support tickets to traces
 * ```typescript
 * import { createDeterministicTraceId } from 'autotel/trace-helpers'
 *
 * // Support dashboard integration
 * const ticketId = 'TICKET-12345'
 * const traceId = await createDeterministicTraceId(ticketId)
 *
 * // Generate direct link to traces in observability backend
 * const traceUrl = `https://your-otel-backend.com/traces/${traceId}`
 * console.log(`View related traces: ${traceUrl}`)
 * ```
 *
 * @example Session-based correlation
 * ```typescript
 * import { createDeterministicTraceId } from 'autotel/trace-helpers'
 *
 * // Track all operations for a user session
 * const sessionId = req.session.id
 * const traceId = await createDeterministicTraceId(sessionId)
 *
 * // All operations in this session share the same trace ID
 * // Makes it easy to find all activity for a specific session
 * ```
 *
 * @public
 */
export async function createDeterministicTraceId(
  seed: string,
): Promise<string> {
  // Encode seed string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(seed);

  // Generate SHA-256 hash (256 bits)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert to hex string and truncate to 32 characters (128 bits)
  // OpenTelemetry trace IDs are 128 bits (16 bytes, 32 hex characters)
  const hashArray = new Uint8Array(hashBuffer);
  return [...hashArray]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Flattens nested metadata objects into dot-notation span attributes.
 *
 * Converts complex nested objects into flat key-value pairs suitable for
 * OpenTelemetry span attributes. Non-string values are JSON serialized.
 * Handles serialization failures gracefully with a fallback value.
 *
 * **Use Cases:**
 * - Structured metadata with nested objects
 * - User context with multiple properties
 * - Request/response metadata
 * - Business entity attributes
 *
 * **Note:** Filters out null/undefined values automatically to keep spans clean.
 *
 * @param metadata - Nested metadata object to flatten
 * @param prefix - Prefix for all attribute keys (default: 'metadata')
 * @returns Flattened attributes as { [key: string]: string }
 *
 * @example Basic metadata flattening
 * ```typescript
 * import { flattenMetadata } from 'autotel/trace-helpers'
 * import { trace } from 'autotel'
 *
 * export const processOrder = trace(ctx => async (orderId: string) => {
 *   const order = await getOrder(orderId)
 *
 *   // Flatten complex order metadata
 *   const flattened = flattenMetadata({
 *     user: { id: order.userId, tier: 'premium' },
 *     payment: { method: 'card', processor: 'stripe' },
 *     items: order.items.length
 *   })
 *
 *   ctx.setAttributes(flattened)
 *   // Results in:
 *   // {
 *   //   'metadata.user.id': 'user-123',
 *   //   'metadata.user.tier': 'premium',
 *   //   'metadata.payment.method': 'card',
 *   //   'metadata.payment.processor': 'stripe',
 *   //   'metadata.items': '5'
 *   // }
 * })
 * ```
 *
 * @example Custom prefix for semantic conventions
 * ```typescript
 * import { flattenMetadata } from 'autotel/trace-helpers'
 * import { trace } from 'autotel'
 *
 * export const fetchUser = trace(ctx => async (userId: string) => {
 *   const user = await db.users.findOne({ id: userId })
 *
 *   // Use semantic convention prefix
 *   const userAttrs = flattenMetadata(
 *     {
 *       id: user.id,
 *       email: user.email,
 *       plan: user.subscription.plan
 *     },
 *     'user'  // Custom prefix
 *   )
 *
 *   ctx.setAttributes(userAttrs)
 *   // Results in:
 *   // {
 *   //   'user.id': 'user-123',
 *   //   'user.email': 'user@example.com',
 *   //   'user.plan': 'enterprise'
 *   // }
 * })
 * ```
 *
 * @example With complex objects (auto-serialized)
 * ```typescript
 * import { flattenMetadata } from 'autotel/trace-helpers'
 * import { trace } from 'autotel'
 *
 * export const analyzeRequest = trace(ctx => async (req: Request) => {
 *   const metadata = flattenMetadata({
 *     headers: req.headers,  // Object - will be JSON serialized
 *     query: req.query,       // Object - will be JSON serialized
 *     timestamp: new Date()   // Non-string - will be JSON serialized
 *   })
 *
 *   ctx.setAttributes(metadata)
 *   // Results in:
 *   // {
 *   //   'metadata.headers': '{"accept":"application/json",...}',
 *   //   'metadata.query': '{"page":"1","limit":"10"}',
 *   //   'metadata.timestamp': '"2024-01-15T12:00:00.000Z"'
 *   // }
 * })
 * ```
 *
 * @example Error handling
 * ```typescript
 * import { flattenMetadata } from 'autotel/trace-helpers'
 *
 * // Objects with circular references are handled gracefully
 * const circular: any = { a: 1 }
 * circular.self = circular
 *
 * const flattened = flattenMetadata({ data: circular })
 * // Results in:
 * // { 'metadata.data': '<serialization-failed>' }
 * ```
 *
 * @public
 */
export function flattenMetadata(
  metadata: Record<string, unknown>,
  prefix = 'metadata',
): Record<string, string> {
  const flattened: Record<string, string> = {};
  const seen = new WeakSet<object>(); // Track visited objects to detect cycles

  function flatten(obj: Record<string, unknown>, currentPrefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      // Skip null/undefined values
      if (value == null) continue;

      const attributeKey = `${currentPrefix}.${key}`;

      // Handle primitives directly (string, number, boolean)
      if (typeof value === 'string') {
        flattened[attributeKey] = value;
        continue;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        flattened[attributeKey] = String(value);
        continue;
      }

      // Recursively flatten plain objects (with cycle detection)
      if (
        typeof value === 'object' &&
        value !== null &&
        value.constructor === Object
      ) {
        // Detect circular references
        if (seen.has(value)) {
          flattened[attributeKey] = '<circular-reference>';
          continue;
        }

        // Mark as visited and recursively flatten
        seen.add(value);
        flatten(value as Record<string, unknown>, attributeKey);
        continue;
      }

      // Serialize arrays and other non-plain objects to JSON
      try {
        flattened[attributeKey] = JSON.stringify(value);
      } catch {
        // Handle circular references or non-serializable objects
        flattened[attributeKey] = '<serialization-failed>';
      }
    }
  }

  flatten(metadata, prefix);
  return flattened;
}
