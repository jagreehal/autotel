import { describe, expect, it, vi } from 'vitest';
import { otlpRelay } from './relay';
import { createDatadogConfig } from './datadog';

function upstream(status = 200, headers: Record<string, string> = {}) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('{"account":"secret details"}', { status, headers }),
  );
}

const post = (url: string, init: RequestInit = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body ?? '{"resourceSpans":[]}',
  });

describe('otlpRelay', () => {
  it('forwards a trace export with the key added on the server', async () => {
    const fetch = upstream();
    const relay = otlpRelay({
      endpoint: 'https://otlp.datadoghq.eu',
      headers: 'dd-api-key=secret,dd-otlp-source=llmobs',
      fetch,
    });

    const response = await relay(
      post('https://app.example.com/otel/v1/traces', {
        headers: { origin: 'https://app.example.com', cookie: 'session=1' },
      }),
    );

    expect(response.status).toBe(200);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://otlp.datadoghq.eu/v1/traces');
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      'dd-api-key': 'secret',
      'dd-otlp-source': 'llmobs',
      'content-type': 'application/json',
    });
  });

  it('takes a backend preset as it is', async () => {
    const fetch = upstream();
    const relay = otlpRelay({
      ...createDatadogConfig({
        apiKey: 'k',
        site: 'datadoghq.eu',
        service: 's',
      }),
      fetch,
    });
    await relay(post('https://app.example.com/otel/v1/logs'));
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://otlp.datadoghq.eu/v1/logs');
    expect(new Headers(init?.headers).get('dd-api-key')).toBe('k');
  });

  it('keeps an endpoint path and query, swapping only the signal', async () => {
    const fetch = upstream();
    const relay = otlpRelay({
      endpoint:
        'https://o1.ingest.sentry.io/api/2/integration/otlp/v1/traces?x=1',
      fetch,
    });
    await relay(post('https://app.example.com/otel/v1/logs'));
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://o1.ingest.sentry.io/api/2/integration/otlp/v1/logs?x=1',
    );
  });

  it('refuses another site posting through a visitor', async () => {
    const fetch = upstream();
    const response = await otlpRelay({ endpoint: 'https://b', fetch })(
      post('https://app.example.com/otel/v1/traces', {
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('allowedOrigins');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts its own site behind a proxy that rewrote Host', async () => {
    // nginx, a load balancer or Vite's proxy: Host is the upstream's, the
    // public host arrives as X-Forwarded-Host, and TLS ended at the proxy.
    const relay = otlpRelay({ endpoint: 'https://b', fetch: upstream() });
    const response = await relay(
      post('http://localhost:8082/otel/v1/traces', {
        headers: {
          origin: 'https://app.example.com',
          'x-forwarded-host': 'app.example.com',
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('says on the server why it refused, once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const relay = otlpRelay({ endpoint: 'https://b', fetch: upstream() });
    for (let index = 0; index < 3; index += 1) {
      await relay(
        post('http://localhost:8082/otel/v1/traces', {
          headers: { origin: 'http://localhost:5174' },
        }),
      );
    }
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('X-Forwarded-Host');
    warn.mockRestore();
  });

  it('warns once however many different origins it refuses', async () => {
    // The dedupe key is the kind of refusal, never the client's Origin: a
    // client inventing origins cannot grow the set or flood the log.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const relay = otlpRelay({ endpoint: 'https://b', fetch: upstream() });
    for (let index = 0; index < 50; index += 1) {
      await relay(
        post('https://app.example.com/otel/v1/traces', {
          headers: { origin: `https://evil-${index}.example` },
        }),
      );
    }
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('lets a listed origin post, with CORS', async () => {
    const relay = otlpRelay({
      endpoint: 'https://b',
      allowedOrigins: ['https://web.example.com'],
      fetch: upstream(),
    });
    const preflight = await relay(
      new Request('https://api.example.com/otel/v1/traces', {
        method: 'OPTIONS',
        headers: { origin: 'https://web.example.com' },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://web.example.com',
    );
    const response = await relay(
      post('https://api.example.com/otel/v1/traces', {
        headers: { origin: 'https://web.example.com' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://web.example.com',
    );
  });

  it('refuses metrics, other paths and other methods', async () => {
    const fetch = upstream();
    const relay = otlpRelay({ endpoint: 'https://b', fetch });
    const metrics = await relay(post('https://a/otel/v1/metrics'));
    const other = await relay(post('https://a/anything'));
    const get = await relay(new Request('https://a/otel/v1/traces'));
    expect(metrics.status).toBe(404);
    expect(other.status).toBe(404);
    expect(get.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a body a page would never send', async () => {
    const fetch = upstream();
    const relay = otlpRelay({ endpoint: 'https://b', maxBodyBytes: 10, fetch });
    const response = await relay(
      post('https://a/otel/v1/traces', { body: 'x'.repeat(11) }),
    );
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops reading a chunked body once it passes the limit', async () => {
    // No Content-Length: the size is only known while reading, so the relay
    // counts as it goes and never takes in the rest.
    const fetch = upstream();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(8));
        if (pulled > 1000) controller.close();
      },
    });
    const relay = otlpRelay({ endpoint: 'https://b', maxBodyBytes: 20, fetch });
    // SAFETY: a streamed body needs `duplex`, which the RequestInit typings
    // do not have yet.
    const init = {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit;
    const response = await relay(new Request('https://a/otel/v1/traces', init));
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes the status back without the backend body', async () => {
    const relay = otlpRelay({
      endpoint: 'https://b',
      fetch: upstream(429, { 'retry-after': '7' }),
    });
    const response = await relay(post('https://a/otel/v1/traces'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(await response.text()).toBe('');
  });

  it('answers 502 when the backend is unreachable', async () => {
    const relay = otlpRelay({
      endpoint: 'https://b',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    const response = await relay(post('https://a/otel/v1/traces'));
    expect(response.status).toBe(502);
  });

  it('says so when a preset has no endpoint to relay to', () => {
    expect(() => otlpRelay({})).toThrow(/useAgent/);
  });
});
