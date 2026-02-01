/**
 * Header utilities for Kafka message processing.
 *
 * Uses OpenTelemetry propagators internally for context extraction,
 * ensuring compatibility with W3C Trace Context, B3, and other formats.
 */

import { propagation, ROOT_CONTEXT, type Context } from 'autotel';
import type { RawKafkaHeaders } from './types';

/**
 * Normalize Kafka headers from raw format to string record.
 *
 * Handles:
 * - undefined/null headers -> empty object
 * - Buffer values -> UTF-8 strings
 * - undefined values -> removed from output
 * - string values -> passed through
 *
 * @param headers - Raw Kafka headers (Buffer/string/undefined values)
 * @returns Normalized headers as string record
 *
 * @example
 * ```typescript
 * const raw = {
 *   traceparent: Buffer.from('00-abc...'),
 *   'content-type': 'application/json',
 *   optionalHeader: undefined,
 * };
 * const normalized = normalizeHeaders(raw);
 * // { traceparent: '00-abc...', 'content-type': 'application/json' }
 * ```
 */
export function normalizeHeaders(
  headers?: RawKafkaHeaders,
): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    normalized[key] = Buffer.isBuffer(value) ? value.toString('utf8') : value;
  }

  return normalized;
}

/**
 * TextMapGetter for case-insensitive header lookup.
 *
 * Kafka headers are case-sensitive, but trace context headers
 * (traceparent, tracestate) should be matched case-insensitively
 * for maximum compatibility.
 */
const caseInsensitiveGetter = {
  get(carrier: Record<string, string>, key: string): string | undefined {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(carrier)) {
      if (k.toLowerCase() === lowerKey) {
        return v;
      }
    }
    return undefined;
  },
  keys(carrier: Record<string, string>): string[] {
    return Object.keys(carrier);
  },
};

/**
 * Extract trace context from normalized headers using OTel propagators.
 *
 * This is a pure function that does not activate any context.
 * The returned Context can be used to:
 * - Start spans as children of the extracted context
 * - Create links to the extracted context
 *
 * Returns ROOT_CONTEXT if no trace context is found in headers.
 *
 * @param headers - Normalized headers (use normalizeHeaders first)
 * @returns OpenTelemetry Context with extracted trace context
 *
 * @example
 * ```typescript
 * import { normalizeHeaders, extractTraceContext } from 'autotel-plugins/kafka';
 * import { trace } from '@opentelemetry/api';
 *
 * const headers = normalizeHeaders(message.headers);
 * const extractedCtx = extractTraceContext(headers);
 *
 * // Get span context from extracted context
 * const spanContext = trace.getSpanContext(extractedCtx);
 * if (spanContext && trace.isSpanContextValid(spanContext)) {
 *   // Valid remote context extracted
 * }
 * ```
 */
export function extractTraceContext(headers: Record<string, string>): Context {
  return propagation.extract(ROOT_CONTEXT, headers, caseInsensitiveGetter);
}
