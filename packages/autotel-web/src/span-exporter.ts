/**
 * Lightweight browser span exporter via sendBeacon/fetch.
 * Sends OTLP/JSON spans so the browser's traceparent spanId
 * exists as a real span in the collector.
 */

let debug = false;
let serviceName = 'browser';
let exportEndpoint: string | undefined;
let pendingSpans: unknown[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let rawFetch: typeof globalThis.fetch | undefined;

/**
 * Provide the unpatched fetch so the exporter bypasses instrumentation.
 * Must be called before init() patches window.fetch.
 */
export function setRawFetch(fn: typeof globalThis.fetch): void {
  rawFetch = fn;
}

export function configureExporter(service: string, endpoint: string, enableDebug = false): void {
  debug = enableDebug;
  serviceName = service;
  exportEndpoint = endpoint.replace(/\/$/, '');
  if (!exportEndpoint.endsWith('/v1/traces')) {
    exportEndpoint += '/v1/traces';
  }
  if (!flushTimer) {
    flushTimer = setInterval(flushSpans, 2000);
  }
}

export function recordSpan(
  traceId: string,
  spanId: string,
  name: string,
  startMs: number,
  endMs: number,
  attrs?: Record<string, string | number>,
): void {
  if (!exportEndpoint) return;
  if (debug) console.log(`[autotel-web] recordSpan: ${name} (${traceId.slice(0, 8)}…)`);
  const attributes = attrs
    ? Object.entries(attrs).map(([key, value]) => ({
        key,
        value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
      }))
    : undefined;
  pendingSpans.push({
    traceId,
    spanId,
    name,
    kind: 3, // CLIENT
    startTimeUnixNano: String(Math.round(startMs * 1_000_000)),
    endTimeUnixNano: String(Math.round(endMs * 1_000_000)),
    attributes,
  });
  // Flush immediately — browser spans are infrequent
  flushSpans();
}

export function flushSpans(): void {
  if (!exportEndpoint || pendingSpans.length === 0) return;
  if (debug) console.log(`[autotel-web] flushSpans: sending ${pendingSpans.length} span(s) to ${exportEndpoint}`);
  const spans = pendingSpans;
  pendingSpans = [];
  const payload = JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
      scopeSpans: [{ scope: { name: 'autotel-web' }, spans }],
    }],
  });
  const blob = new Blob([payload], { type: 'application/json' });
  const sent = typeof navigator?.sendBeacon === 'function' && navigator.sendBeacon(exportEndpoint, blob);
  if (!sent && rawFetch) {
    rawFetch(exportEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}

export function isConfigured(): boolean {
  return exportEndpoint !== undefined;
}

export function resetForTesting(): void {
  exportEndpoint = undefined;
  pendingSpans = [];
  if (flushTimer) { clearInterval(flushTimer); flushTimer = undefined; }
}
