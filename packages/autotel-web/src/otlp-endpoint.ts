/**
 * Normalise an OTLP HTTP trace endpoint.
 *
 * `init()` accepted a bare origin and appended the path, while `initFull()`
 * passed the value straight to the exporter — so the same `endpoint` config
 * meant two different things and a bare origin silently 404'd in full mode.
 * Both now share this.
 */
const TRACES_PATH = '/v1/traces';

export function normaliseOtlpEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith(TRACES_PATH) ? trimmed : `${trimmed}${TRACES_PATH}`;
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
