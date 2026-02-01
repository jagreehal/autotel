/**
 * Header utilities for RabbitMQ message processing.
 *
 * Uses OpenTelemetry propagators internally for context extraction,
 * ensuring compatibility with W3C Trace Context, B3, and other formats.
 */

import { propagation, ROOT_CONTEXT, type Context } from 'autotel';
import type { RawAmqpHeaders } from './types';

/**
 * Normalize AMQP headers from raw format to string record.
 *
 * Handles:
 * - undefined/null headers -> empty object
 * - Buffer values -> UTF-8 strings (with base64 fallback for invalid UTF-8)
 * - undefined values -> removed from output
 * - string values -> passed through
 * - number/boolean values -> String() conversion
 * - object values -> JSON.stringify() (dropped if > 1KB)
 *
 * @param headers - Raw AMQP headers (Record or undefined)
 * @returns Normalized headers as string record
 *
 * @example
 * ```typescript
 * const raw = {
 *   traceparent: Buffer.from('00-abc...'),
 *   'content-type': 'application/json',
 *   optionalHeader: undefined,
 *   retryCount: 3,
 * };
 * const normalized = normalizeHeaders(raw);
 * // { traceparent: '00-abc...', 'content-type': 'application/json', retryCount: '3' }
 * ```
 */
export function normalizeHeaders(
  headers?: RawAmqpHeaders,
): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};
  const MAX_OBJECT_SIZE = 1024; // 1KB limit for stringified objects

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Buffer.isBuffer(value)) {
      // Try UTF-8 decode, fall back to base64 with prefix
      try {
        const decoded = value.toString('utf8');
        // Check if the string is valid UTF-8 by re-encoding and comparing
        normalized[key] = Buffer.from(decoded, 'utf8').equals(value)
          ? decoded
          : `base64:${value.toString('base64')}`;
      } catch {
        normalized[key] = `base64:${value.toString('base64')}`;
      }
    } else if (typeof value === 'string') {
      normalized[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = String(value);
    } else if (typeof value === 'object') {
      // Stringify objects, drop if too large
      try {
        const json = JSON.stringify(value);
        if (json.length <= MAX_OBJECT_SIZE) {
          normalized[key] = json;
        }
        // Silently drop objects > 1KB
      } catch {
        // Silently drop objects that can't be stringified
      }
    }
  }

  return normalized;
}

/**
 * TextMapGetter for case-insensitive header lookup.
 *
 * AMQP headers can have varying case, but trace context headers
 * (traceparent, tracestate, baggage) should be matched case-insensitively
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
 * import { normalizeHeaders, extractTraceContext } from 'autotel-plugins/rabbitmq';
 * import { trace } from '@opentelemetry/api';
 *
 * const headers = normalizeHeaders(message.properties.headers);
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
