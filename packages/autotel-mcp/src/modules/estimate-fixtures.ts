/**
 * Byte sizes for the cost estimate, measured rather than assumed.
 *
 * Each constant is the serialized size of a real record for the same checkout
 * request: what a line-per-step logger writes, what one canonical log line
 * holds, and what one exported span costs. Measuring at module load means the
 * figures cannot drift away from the shapes they claim to describe — edit a
 * fixture and the estimate moves with it.
 *
 * The saving these produce comes from dropping repeated envelope (level, time,
 * pid, hostname, request bindings, once per line) rather than from dropping
 * payload, which is why one canonical line is much larger than one log line
 * and still much smaller than the set it replaces.
 */

/** What a line-per-step logger writes while serving one checkout request. */
const SCATTERED_LINES = [
  {
    level: 30,
    time: 1_770_000_000_000,
    pid: 4821,
    hostname: 'checkout-7d9f5b8c4-x2klm',
    reqId: 'req_01HQZX9K3M',
    msg: 'request received',
  },
  {
    level: 30,
    time: 1_770_000_000_012,
    pid: 4821,
    hostname: 'checkout-7d9f5b8c4-x2klm',
    reqId: 'req_01HQZX9K3M',
    userId: 'usr_8f21c0',
    msg: 'cart loaded',
  },
  {
    level: 30,
    time: 1_770_000_000_089,
    pid: 4821,
    hostname: 'checkout-7d9f5b8c4-x2klm',
    reqId: 'req_01HQZX9K3M',
    provider: 'stripe',
    msg: 'payment authorized',
  },
  {
    level: 30,
    time: 1_770_000_000_141,
    pid: 4821,
    hostname: 'checkout-7d9f5b8c4-x2klm',
    reqId: 'req_01HQZX9K3M',
    status: 200,
    msg: 'request completed',
  },
];

/**
 * The same request as one canonical log line, in the shape
 * `CanonicalLogLineProcessor` emits: span attributes, then the operation and
 * context fields it stamps on top.
 */
const CANONICAL_LINE = {
  'http.request.method': 'POST',
  'http.route': '/checkout',
  'http.response.status_code': 200,
  'url.path': '/checkout',
  'user.id': 'usr_8f21c0',
  'cart.items': 3,
  'cart.value': 129.99,
  'payment.provider': 'stripe',
  'payment.outcome': 'authorized',
  'service.name': 'checkout',
  operation: 'POST /checkout',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  correlationId: '4bf92f3577b34da6',
  duration_ms: 141.27,
  duration: '141ms',
  status_code: 1,
  timestamp: '2026-02-02T00:00:00.000Z',
};

/** One exported span for the payment call inside that request, as OTLP JSON. */
const SPAN = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '1a2b3c4d5e6f7081',
  parentSpanId: '00f067aa0ba902b7',
  name: 'payment.authorize',
  kind: 3,
  startTimeUnixNano: '1770000000012000000',
  endTimeUnixNano: '1770000000089000000',
  attributes: [
    { key: 'payment.provider', value: { stringValue: 'stripe' } },
    { key: 'payment.amount', value: { doubleValue: 129.99 } },
    { key: 'http.request.method', value: { stringValue: 'POST' } },
  ],
  status: { code: 1 },
};

/** Serialized size plus the newline a line-delimited transport adds. */
function lineBytes(record: unknown): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8') + 1;
}

/** Mean size of one scattered line, so the count stays a caller's input. */
export const LOG_LINE_BYTES = Math.round(
  SCATTERED_LINES.reduce((total, line) => total + lineBytes(line), 0) /
    SCATTERED_LINES.length,
);

export const CANONICAL_LINE_BYTES = lineBytes(CANONICAL_LINE);

export const SPAN_BYTES = lineBytes(SPAN);
