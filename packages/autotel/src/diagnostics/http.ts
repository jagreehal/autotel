/**
 * Lightweight HTTP spans via Node's built-in `diagnostics_channel` — no
 * monkey-patching, no `import-in-the-middle`.
 *
 * Node publishes `http.server.request.start` / `http.server.response.finish`
 * and `http.client.request.start` / `http.client.response.finish` /
 * `http.client.request.error`. {@link instrumentHttp} subscribes to those and
 * emits a `SERVER` span per inbound request (parented to an incoming W3C
 * `traceparent`) and a `CLIENT` span per outbound request (whose context it
 * injects into the outgoing headers for downstream propagation).
 *
 * ```ts
 * import { instrumentHttp } from 'autotel/diagnostics';
 *
 * const stop = instrumentHttp();
 * ```
 *
 * Scope & limitation. This is an opt-in, low-overhead alternative to
 * `@opentelemetry/instrumentation-http` for HTTP span coverage + W3C
 * propagation. Client-side propagation works (the `traceparent` is injected on
 * the `ClientRequest` object directly). What it does **not** do is establish an
 * *ambient* OpenTelemetry context for the duration of a server request handler,
 * so application spans created inside a handler will not become children of the
 * `SERVER` span.
 *
 * This is structural, not a "wait for a newer Node" gap. Node publishes the
 * `http.*` channels with a plain `channel.publish()` — not `runStores` /
 * `tracingChannel` — so a subscriber has no scope to bind a store to. The only
 * ways to get handler nesting both defeat the purpose of using a channel:
 *   1. `AsyncLocalStorage.enterWith()` in the start handler — no scoped exit, so
 *      context leaks across requests sharing an event-loop tick / keep-alive
 *      connection and misattributes spans. Strictly worse than no nesting.
 *   2. Patching `http.Server.prototype.emit` to wrap the `'request'` listener in
 *      `context.with()` — monkey-patching, i.e. reimplementing
 *      `@opentelemetry/instrumentation-http`.
 * If you need handler nesting, use `@opentelemetry/instrumentation-http`.
 *
 * The `http.*` channels are a Stability-1 (experimental) Node API; this module
 * degrades to a no-op where they are unavailable.
 */

import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import {
  context as otelContext,
  defaultTextMapGetter,
  defaultTextMapSetter,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_NETWORK_PROTOCOL_VERSION,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_SCHEME,
  ATTR_USER_AGENT_ORIGINAL,
} from '@opentelemetry/semantic-conventions';
import { subscribeChannel } from './channel.js';

export interface InstrumentHttpOptions {
  /** Instrument inbound (server) requests. Default `true`. */
  server?: boolean;
  /** Instrument outbound (client) requests. Default `true`. */
  client?: boolean;
  /** Tracer to use. Defaults to `trace.getTracer('autotel.http-diagnostics')`. */
  tracer?: Tracer;
}

interface ServerStartMessage {
  request?: IncomingMessage;
  response?: ServerResponse;
}
interface ServerFinishMessage {
  request?: IncomingMessage;
  response?: ServerResponse;
}
interface ClientStartMessage {
  request?: ClientRequest;
}
interface ClientFinishMessage {
  request?: ClientRequest;
  response?: IncomingMessage;
}
interface ClientErrorMessage {
  request?: ClientRequest;
  error?: unknown;
}

const SERVER_SPANS = new WeakMap<object, Span>();
const CLIENT_SPANS = new WeakMap<object, Span>();

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function splitHostPort(host: string | undefined): {
  address?: string;
  port?: number;
} {
  if (!host) return {};
  const idx = host.lastIndexOf(':');
  if (idx === -1) return { address: host };
  const port = Number(host.slice(idx + 1));
  return {
    address: host.slice(0, idx),
    port: Number.isFinite(port) ? port : undefined,
  };
}

/**
 * Start emitting HTTP server/client spans from Node's HTTP diagnostics
 * channels. Returns a disposer; a no-op on runtimes without the channels.
 */
export function instrumentHttp(
  options: InstrumentHttpOptions = {},
): () => void {
  const tracer = options.tracer ?? trace.getTracer('autotel.http-diagnostics');
  const disposers: Array<() => void> = [];

  if (options.server !== false) {
    disposers.push(
      subscribeChannel('http.server.request.start', (message) => {
        const request = (message as ServerStartMessage)?.request;
        if (!request) return;
        const method = request.method ?? 'HTTP';
        const host = firstHeader(request.headers.host);
        const { address, port } = splitHostPort(host);
        const path = (request.url ?? '/').split('?', 1)[0];
        const attributes: Attributes = {
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_URL_PATH]: path,
          [ATTR_URL_SCHEME]: 'http',
          [ATTR_NETWORK_PROTOCOL_VERSION]: request.httpVersion,
          [ATTR_USER_AGENT_ORIGINAL]: firstHeader(
            request.headers['user-agent'],
          ),
          [ATTR_SERVER_ADDRESS]: address,
          [ATTR_SERVER_PORT]: port,
        };
        const parent = propagation.extract(
          otelContext.active(),
          request.headers,
          defaultTextMapGetter,
        );
        const span = tracer.startSpan(
          method,
          { kind: SpanKind.SERVER, attributes },
          parent,
        );
        SERVER_SPANS.set(request, span);
      }),
      subscribeChannel('http.server.response.finish', (message) => {
        const { request, response } = (message as ServerFinishMessage) ?? {};
        if (!request) return;
        const span = SERVER_SPANS.get(request);
        if (!span) return;
        SERVER_SPANS.delete(request);
        finishHttpSpan(span, response?.statusCode, 500);
      }),
    );
  }

  if (options.client !== false) {
    disposers.push(
      subscribeChannel('http.client.request.start', (message) => {
        const request = (message as ClientStartMessage)?.request;
        if (!request) return;
        const method = request.method ?? 'HTTP';
        // `ClientRequest` exposes host/protocol/path on the public surface.
        const req = request as ClientRequest & {
          host?: string;
          protocol?: string;
          path?: string;
        };
        const { address, port } = splitHostPort(req.host);
        const scheme = (req.protocol ?? 'http:').replace(':', '');
        const attributes: Attributes = {
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_SERVER_ADDRESS]: address,
          [ATTR_SERVER_PORT]: port,
          [ATTR_URL_FULL]:
            address && req.path
              ? `${scheme}://${req.host}${req.path}`
              : undefined,
        };
        const span = tracer.startSpan(method, {
          kind: SpanKind.CLIENT,
          attributes,
        });
        CLIENT_SPANS.set(request, span);

        // Inject this span's context into the outbound headers so the
        // downstream service continues the trace.
        if (!request.headersSent) {
          const carrier: Record<string, string> = {};
          propagation.inject(
            trace.setSpan(otelContext.active(), span),
            carrier,
            defaultTextMapSetter,
          );
          for (const [key, value] of Object.entries(carrier)) {
            try {
              request.setHeader(key, value);
            } catch {
              // Headers already sent / immutable — propagation best-effort.
            }
          }
        }
      }),
      subscribeChannel('http.client.response.finish', (message) => {
        const { request, response } = (message as ClientFinishMessage) ?? {};
        if (!request) return;
        const span = CLIENT_SPANS.get(request);
        if (!span) return;
        CLIENT_SPANS.delete(request);
        finishHttpSpan(span, response?.statusCode, 400);
      }),
      subscribeChannel('http.client.request.error', (message) => {
        const { request, error } = (message as ClientErrorMessage) ?? {};
        if (!request) return;
        const span = CLIENT_SPANS.get(request);
        if (!span) return;
        CLIENT_SPANS.delete(request);
        if (error instanceof Error) span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : undefined,
        });
        span.end();
      }),
    );
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const dispose of disposers) dispose();
  };
}

/** Set status code + error status (when `>= errorAt`) and end the span. */
function finishHttpSpan(
  span: Span,
  statusCode: number | undefined,
  errorAt: number,
): void {
  if (statusCode !== undefined) {
    span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, statusCode);
    if (statusCode >= errorAt) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  }
  span.end();
}
