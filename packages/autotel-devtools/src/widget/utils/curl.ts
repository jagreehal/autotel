/**
 * Rebuild an HTTP request from the span that recorded it.
 *
 * **This is a starting point, not a replay, and the UI says so.** A span
 * carries the method and the URL reliably, headers only where someone opted
 * into capturing them, and a body essentially never — nor should it, since
 * that is how request payloads end up in telemetry. What comes out is
 * something you paste and then edit.
 *
 * Both attribute vocabularies are read. Semconv renamed these at 1.0
 * (`http.method` to `http.request.method`, `http.url` to `url.full`) and
 * plenty of running services still emit the older names, so a viewer that
 * only understood the new ones would show nothing for half the traces it is
 * pointed at.
 */

import type { SpanData } from '../types';

/** Single-quote for a POSIX shell, closing and reopening around each quote. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return undefined;
}

/** The recorded URL, or one assembled from the parts semconv splits it into. */
function urlOf(attributes: Record<string, unknown>): string | undefined {
  const full = text(attributes['url.full']) ?? text(attributes['http.url']);
  if (full) return full;

  const host =
    text(attributes['server.address']) ?? text(attributes['net.peer.name']);
  const path = text(attributes['url.path']) ?? text(attributes['http.target']);
  if (!host || !path) return undefined;

  const scheme = text(attributes['url.scheme']) ?? 'https';
  const port = text(attributes['server.port']);
  const query = text(attributes['url.query']);
  const authority =
    port && port !== '80' && port !== '443' ? `${host}:${port}` : host;
  return `${scheme}://${authority}${path}${query ? `?${query}` : ''}`;
}

/**
 * A `curl` command for this span, or null when it did not record a request.
 *
 * Null is what hides the button: offering "copy as curl" on a database span
 * and producing something unrunnable is worse than not offering it.
 */
export function curlFromSpan(span: SpanData): string | null {
  const attributes = (span.attributes ?? {}) as Record<string, unknown>;
  const method =
    text(attributes['http.request.method']) ?? text(attributes['http.method']);
  const url = urlOf(attributes);
  if (!method || !url) return null;

  const parts = [`curl -X ${method.toUpperCase()}`, shellQuote(url)];

  // Sorted so the same span always produces the same command, which matters
  // the moment anyone diffs two of them.
  const headers = Object.entries(attributes)
    .filter(([key]) => key.startsWith('http.request.header.'))
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [key, value] of headers) {
    const name = key.slice('http.request.header.'.length);
    const rendered = Array.isArray(value)
      ? value.map(String).join(', ')
      : text(value);
    if (rendered) parts.push(`-H ${shellQuote(`${name}: ${rendered}`)}`);
  }

  return parts.join(' ');
}
