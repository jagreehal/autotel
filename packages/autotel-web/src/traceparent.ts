/**
 * Minimal W3C Trace Context implementation for browser
 *
 * Generates traceparent headers in the W3C format:
 * traceparent: 00-{trace-id}-{span-id}-{flags}
 *
 * No OpenTelemetry dependencies - just crypto.getRandomValues()
 */

/**
 * Generate random hex string of specified byte length
 */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a random 128-bit (16 byte) trace ID
 * @returns 32 character hex string
 */
export function generateTraceId(): string {
  return randomHex(16); // 16 bytes = 32 hex chars
}

/**
 * Generate a random 64-bit (8 byte) span ID
 * @returns 16 character hex string
 */
export function generateSpanId(): string {
  return randomHex(8); // 8 bytes = 16 hex chars
}

/**
 * Create a W3C traceparent header value
 *
 * Format: version-traceId-spanId-flags
 * - version: 00 (W3C Trace Context spec)
 * - traceId: 128-bit hex (32 chars)
 * - spanId: 64-bit hex (16 chars)
 * - flags: 01 (sampled)
 *
 * @param traceId - Optional existing trace ID (for continuing traces)
 * @param parentSpanId - Optional parent span ID (unused in browser, included for API compat)
 * @returns W3C traceparent header value
 *
 * @example
 * ```typescript
 * const header = createTraceparent()
 * // "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
 * ```
 */
export function createTraceparent(
  traceId?: string,
  _parentSpanId?: string
): string {
  const tid = traceId ?? generateTraceId();
  const sid = generateSpanId();
  const flags = '01'; // sampled=1

  return `00-${tid}-${sid}-${flags}`;
}

/**
 * Parse a traceparent header value
 * Useful for extracting trace context from incoming headers
 *
 * @param traceparent - W3C traceparent header value
 * @returns Parsed components or null if invalid
 *
 * @example
 * ```typescript
 * const parsed = parseTraceparent('00-4bf92f...0e4736-00f067...902b7-01')
 * console.log(parsed?.traceId) // "4bf92f...0e4736"
 * ```
 */
export function parseTraceparent(traceparent: string): {
  version: string;
  traceId: string;
  spanId: string;
  flags: string;
} | null {
  const parts = traceparent.split('-');

  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, flags] = parts;

  // Validate format
  if (
    version.length !== 2 ||
    traceId.length !== 32 ||
    spanId.length !== 16 ||
    flags.length !== 2
  ) {
    return null;
  }

  return { version, traceId, spanId, flags };
}
