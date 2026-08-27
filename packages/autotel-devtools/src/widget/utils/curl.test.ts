/**
 * Rebuilding a request from a span.
 *
 * Deliberately partial, and the UI has to say so: a span carries the method
 * and the URL reliably, headers only when someone opted into capturing them,
 * and a body essentially never. What this produces is a starting point you
 * edit, not a faithful replay.
 */

import { describe, it, expect } from 'vitest';
import { curlFromSpan } from './curl';
import type { SpanData } from '../types';

function span(attributes: Record<string, unknown>): SpanData {
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    name: 'GET /users',
    kind: 'CLIENT',
    startTime: 1,
    endTime: 2,
    duration: 1,
    attributes: attributes as SpanData['attributes'],
    status: { code: 'OK' },
  };
}

describe('curlFromSpan', () => {
  it('builds from the current semconv attributes', () => {
    const command = curlFromSpan(
      span({
        'http.request.method': 'POST',
        'url.full': 'https://api.test/v1/orders',
      }),
    );

    expect(command).toBe("curl -X POST 'https://api.test/v1/orders'");
  });

  it('reads the superseded attribute names too', () => {
    // Plenty of running services still emit the pre-1.0 names.
    const command = curlFromSpan(
      span({ 'http.method': 'GET', 'http.url': 'https://api.test/v1/health' }),
    );

    expect(command).toBe("curl -X GET 'https://api.test/v1/health'");
  });

  it('assembles a URL from its parts when no full one was recorded', () => {
    const command = curlFromSpan(
      span({
        'http.request.method': 'GET',
        'url.scheme': 'https',
        'server.address': 'api.test',
        'url.path': '/v1/orders',
        'url.query': 'page=2',
      }),
    );

    expect(command).toBe("curl -X GET 'https://api.test/v1/orders?page=2'");
  });

  it('includes captured request headers', () => {
    const command = curlFromSpan(
      span({
        'http.request.method': 'GET',
        'url.full': 'https://api.test/v1/orders',
        'http.request.header.accept': 'application/json',
      }),
    );

    expect(command).toBe(
      "curl -X GET 'https://api.test/v1/orders' -H 'accept: application/json'",
    );
  });

  it('escapes a quote rather than ending the shell string early', () => {
    const command = curlFromSpan(
      span({
        'http.request.method': 'GET',
        'url.full': "https://api.test/o'brien",
      }),
    );

    expect(command).toBe("curl -X GET 'https://api.test/o'\\''brien'");
  });

  it('returns null for a span that was never an HTTP request', () => {
    expect(curlFromSpan(span({ 'db.system': 'postgresql' }))).toBeNull();
    // A method with nowhere to send it is not a request either.
    expect(curlFromSpan(span({ 'http.request.method': 'GET' }))).toBeNull();
  });
});
