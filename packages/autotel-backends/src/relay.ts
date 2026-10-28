/**
 * The server half of exporting from a browser to a backend that needs a
 * secret.
 *
 * Datadog, Honeycomb and Grafana authenticate OTLP with an API key, and a key
 * shipped to a page is a key anyone can use. So the page exports to its own
 * origin and this forwards the request with the key added on the server:
 *
 * ```ts
 * // server: any framework that speaks Request/Response (Hono, Next, Workers)
 * import { otlpRelay } from 'autotel-backends/relay';
 * import { createDatadogConfig } from 'autotel-backends/datadog';
 *
 * const relay = otlpRelay(createDatadogConfig({ apiKey, site: 'datadoghq.eu' }));
 * app.post('/otel/v1/*', (c) => relay(c.req.raw));
 *
 * // browser
 * initFull({ service: 'web', endpoint: '/otel' });
 * ```
 *
 * It takes the same `{ endpoint, headers }` every backend preset returns, so
 * one relay works for any of them. Uses only the Fetch API.
 */

import { normalizeHeaders } from './headers';

export interface OtlpRelayOptions {
  /** The backend's OTLP base URL, as `init()` takes it. */
  endpoint?: string;
  /**
   * Headers to add on the server: the backend's auth. Either a record or the
   * `key=value,key=value` string the backend presets return.
   */
  headers?: Record<string, string> | string;
  /**
   * Origins allowed to post, besides the relay's own. Cross-origin callers
   * also get CORS headers. Without this, only same-origin pages may post.
   */
  allowedOrigins?: string[];
  /**
   * Largest request body forwarded, in bytes. The relay spends your API key,
   * so it refuses what a page would never send.
   *
   * @default 1_048_576 (1 MiB)
   */
  maxBodyBytes?: number;
  /** Replaces `globalThis.fetch` for the upstream call. For tests. */
  fetch?: typeof fetch;
}

/** OTLP signals a page exports. Metrics stay server-side. */
const SIGNALS = ['traces', 'logs'] as const;

/** The only request headers forwarded: what the payload needs to be read. */
const FORWARDED = ['content-type', 'content-encoding'] as const;

/**
 * The request body, or undefined once it passes `limit` bytes. Stops reading
 * at that point and cancels the rest of the stream.
 */
async function readAtMost(
  request: Request,
  limit: number,
): Promise<Uint8Array | undefined> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function upstreamUrl(endpoint: string, signal: string): string {
  const [base, query = ''] = endpoint.split('?');
  const root = base!.replace(/\/+$/, '').replace(/\/v1\/(traces|logs)$/, '');
  return `${root}/v1/${signal}${query ? `?${query}` : ''}`;
}

/**
 * The hosts this request was addressed to: its own, and the public one a
 * reverse proxy (nginx, a load balancer, Vite with `xfwd`) passes in
 * X-Forwarded-Host when it rewrites Host. Host only, not scheme: TLS usually
 * ends at the proxy, so the page is https and the relay sees http. A page on
 * another site cannot set X-Forwarded-Host without a preflight, which this
 * relay refuses.
 */
function publicHosts(request: Request, url: URL): string[] {
  const forwarded = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  return forwarded ? [url.host, forwarded] : [url.host];
}

function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

/** The kinds of refusal, each warned about once. */
type RefusalKind = 'origin' | 'path' | 'size' | 'upstream';

/** A client-supplied value, quoted and capped before it reaches a log. */
function quoted(value: string): string {
  return JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value);
}

const refuse = (
  status: number,
  reason: string,
  extra?: Record<string, string>,
) =>
  new Response(reason, {
    status,
    headers: { 'content-type': 'text/plain', ...extra },
  });

/**
 * A `(request) => Response` handler that forwards OTLP traces and logs from a
 * page to `endpoint`, with `headers` added. The signal is taken from the
 * request path (`…/v1/traces` or `…/v1/logs`); anything else is refused.
 */
export function otlpRelay(
  options: OtlpRelayOptions,
): (request: Request) => Promise<Response> {
  const { endpoint } = options;
  if (!endpoint) {
    throw new Error(
      'otlpRelay needs the backend endpoint. A preset created with ' +
        'useAgent: true has none to relay to.',
    );
  }
  const auth = normalizeHeaders(options.headers) ?? {};
  const allowed = new Set(options.allowedOrigins);
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const send = options.fetch ?? globalThis.fetch;

  /**
   * Said once per kind of refusal, on the server. The page's exporter only
   * sees a status, so a relay refusing every export is otherwise silent.
   * Keyed by the fixed kind, never by request content: the set holds at most
   * one entry per kind, however many origins a client invents.
   */
  const warned = new Set<RefusalKind>();
  const refuseLoudly = (
    kind: RefusalKind,
    status: number,
    reason: string,
    extra?: Record<string, string>,
  ): Response => {
    if (!warned.has(kind)) {
      warned.add(kind);
      console.warn(`[autotel-backends/relay] ${status}: ${reason}`);
    }
    return refuse(status, reason, extra);
  };

  return async (request) => {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const host = origin === null ? undefined : hostOf(origin);
    const sameOrigin =
      origin === null ||
      (host !== undefined && publicHosts(request, url).includes(host));
    const crossOrigin = origin !== null && !sameOrigin && allowed.has(origin);
    if (!sameOrigin && !crossOrigin) {
      return refuseLoudly(
        'origin',
        403,
        `Origin ${quoted(origin)} may not post to this relay. Add it to ` +
          'otlpRelay({ allowedOrigins }). If it is this site, the relay sees ' +
          `the host ${publicHosts(request, url).join(' / ')}: a proxy in front ` +
          'rewrote Host without setting X-Forwarded-Host.',
      );
    }
    const cors: Record<string, string> =
      crossOrigin && origin
        ? { 'access-control-allow-origin': origin, vary: 'origin' }
        : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': FORWARDED.join(', '),
          'access-control-max-age': '86400',
        },
      });
    }
    if (request.method !== 'POST') {
      return refuse(405, 'POST only.', { ...cors, allow: 'POST' });
    }

    const signal = SIGNALS.find((name) =>
      url.pathname.replace(/\/+$/, '').endsWith(`/v1/${name}`),
    );
    if (!signal) {
      return refuseLoudly(
        'path',
        404,
        'Expected a path ending in /v1/traces or /v1/logs.',
        cors,
      );
    }

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > maxBodyBytes) {
      return refuseLoudly(
        'size',
        413,
        `Body over ${maxBodyBytes} bytes.`,
        cors,
      );
    }
    // Counted as it arrives: a chunked body declares no length, and buffering
    // it whole before measuring would let one request hold any amount of
    // memory.
    const body = await readAtMost(request, maxBodyBytes);
    if (body === undefined) {
      return refuseLoudly(
        'size',
        413,
        `Body over ${maxBodyBytes} bytes.`,
        cors,
      );
    }

    const headers = new Headers(auth);
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    let upstream: Response;
    try {
      upstream = await send(upstreamUrl(endpoint, signal), {
        method: 'POST',
        headers,
        body,
      });
    } catch {
      return refuseLoudly(
        'upstream',
        502,
        'The backend could not be reached.',
        cors,
      );
    }
    // Status only: the exporter retries on it, and the backend's own error
    // body can name the account.
    await upstream.body?.cancel();
    const retryAfter = upstream.headers.get('retry-after');
    return new Response(null, {
      status: upstream.status,
      headers: retryAfter ? { ...cors, 'retry-after': retryAfter } : cors,
    });
  };
}
