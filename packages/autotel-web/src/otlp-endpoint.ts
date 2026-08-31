/**
 * Normalise an OTLP HTTP trace endpoint.
 *
 * `init()` accepted a bare origin and appended the path, while `initFull()`
 * passed the value straight to the exporter — so the same `endpoint` config
 * meant two different things and a bare origin silently 404'd in full mode.
 * Both now share this.
 */
const TRACES_PATH = '/v1/traces';
const LOGS_PATH = '/v1/logs';

export function normaliseOtlpEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith(TRACES_PATH) ? trimmed : `${trimmed}${TRACES_PATH}`;
}

/** OTLP signals this package exports. */
export type OtlpSignal = 'traces' | 'logs';

/**
 * The endpoint for one signal. Callers configure a single `endpoint`, which may
 * already carry the traces path; the signal path is swapped rather than
 * appended, so `https://host/v1/traces` still yields `https://host/v1/logs`.
 */
export function otlpEndpointFor(endpoint: string, signal: OtlpSignal): string {
  const base = normaliseOtlpEndpoint(endpoint).slice(0, -TRACES_PATH.length);
  return `${base}${signal === 'logs' ? LOGS_PATH : TRACES_PATH}`;
}

/**
 * URLs the browser instrumentations must not trace.
 *
 * Without this the exporter's own POST to the collector is traced, producing a
 * span, which is exported, which produces another span. The loop floods the
 * collector and starves real spans out of the batch buffer.
 */
export function selfInstrumentationIgnoreUrls(
  endpoint: string | undefined,
): RegExp[] {
  if (endpoint === undefined) return [];
  const url = normaliseOtlpEndpoint(endpoint);
  return [new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')];
}
