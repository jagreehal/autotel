import { context, propagation, type Context } from '@opentelemetry/api';
import type { McpTraceMeta } from './types.js';

/**
 * Extract OpenTelemetry context from MCP _meta field
 *
 * This enables distributed tracing across MCP client-server boundaries
 * by extracting W3C Trace Context from the _meta field.
 *
 * @param meta - The _meta object from MCP request
 * @returns OpenTelemetry context with extracted trace data
 *
 * @example
 * ```typescript
 * // In MCP tool handler
 * const handler = async (args, _meta) => {
 *   const parentContext = extractOtelContextFromMeta(_meta);
 *   return context.with(parentContext, async () => {
 *     // Your traced code here
 *   });
 * };
 * ```
 */
export function extractOtelContextFromMeta(
  meta?: Record<string, unknown>,
): Context {
  if (!meta || typeof meta !== 'object') {
    return context.active();
  }

  // Build carrier object with trace context headers
  const carrier: Record<string, string> = {};

  if (typeof meta.traceparent === 'string' && meta.traceparent) {
    carrier.traceparent = meta.traceparent;
  }

  if (typeof meta.tracestate === 'string' && meta.tracestate) {
    carrier.tracestate = meta.tracestate;
  }

  if (typeof meta.baggage === 'string' && meta.baggage) {
    carrier.baggage = meta.baggage;
  }

  // If no trace context found, return active context
  if (Object.keys(carrier).length === 0) {
    return context.active();
  }

  // Extract context using OpenTelemetry propagation API
  return propagation.extract(context.active(), carrier);
}

/**
 * Inject OpenTelemetry context into MCP _meta field
 *
 * This enables distributed tracing by injecting W3C Trace Context
 * into the _meta field of MCP requests.
 *
 * @param ctx - Optional context to inject (defaults to active context)
 * @returns _meta object with trace context
 *
 * @example
 * ```typescript
 * // In MCP client
 * const result = await client.callTool('get_weather', {
 *   location: 'NYC',
 *   _meta: injectOtelContextToMeta()
 * });
 * ```
 */
export function injectOtelContextToMeta(ctx?: Context): McpTraceMeta {
  const carrier: Record<string, string> = {};
  const activeContext = ctx ?? context.active();

  // Inject current context into carrier using OpenTelemetry propagation API
  propagation.inject(activeContext, carrier);

  return {
    traceparent: carrier.traceparent,
    tracestate: carrier.tracestate,
    baggage: carrier.baggage,
  };
}

/**
 * Activate trace context from _meta field
 *
 * Helper function that extracts and immediately activates the trace context.
 * Useful for synchronous activation of parent context.
 *
 * @param meta - The _meta object from MCP request
 * @returns Activated context
 *
 * @example
 * ```typescript
 * const handler = async (args, _meta) => {
 *   const ctx = activateTraceContext(_meta);
 *   return context.with(ctx, () => {
 *     // Traced code with parent context active
 *   });
 * };
 * ```
 */
export function activateTraceContext(meta?: Record<string, unknown>): Context {
  return extractOtelContextFromMeta(meta);
}
