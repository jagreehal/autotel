/**
 * OTLP headers in either form the presets and users have: the
 * `key=value,key=value` string of `OTEL_EXPORTER_OTLP_HEADERS` (values
 * percent-encoded, as the specification has them) or an already-parsed
 * record. Undefined when there are none.
 */
export function normalizeHeaders(
  headers: string | Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (typeof headers === 'object') return headers;
  const out: Record<string, string> = {};
  for (const pair of headers.split(',')) {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      let value = valueParts.join('=').trim();
      value = value.replaceAll('%20', ' ');
      out[key.trim()] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
