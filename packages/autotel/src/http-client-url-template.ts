/**
 * Names outbound HTTP client spans `{method} {url.template}`, as the HTTP
 * semantic conventions allow once a low-cardinality template is known.
 *
 * The instrumentations name a client span `{method}` alone: they cannot tell
 * which path segments are ids. The caller can, so `httpClientUrlTemplate`
 * maps a request to its template, and the instrumentations' own
 * `requestHook`s apply it. With no template the span keeps its name, because
 * a raw path in the name would give every id a group of its own.
 */

import type { Span } from '@opentelemetry/api';
import type { InstrumentationSwitches } from './auto-instrumentations';

/**
 * Maps an outgoing request to its `url.template`, such as `/users/{id}`, or
 * `undefined` to leave the span as the instrumentation named it.
 */
export type HttpClientUrlTemplate = (
  url: URL,
  method: string,
) => string | undefined;

/** The parts of `http.ClientRequest` the hook reads. */
interface OutgoingRequest {
  method: string;
  protocol: string;
  /** The hostname alone: no port, and an IPv6 address without brackets. */
  host: string;
  path: string;
  getHeader(name: string): number | string | string[] | undefined;
}

/**
 * What `instrumentation-http` hands its hook: an outgoing `ClientRequest`, or
 * the server's `IncomingMessage`, which has no `protocol` or `host`.
 */
type HttpRequest = Partial<OutgoingRequest>;

/** The parts of an undici request (Node's `fetch`) the hook reads. */
interface UndiciRequest {
  origin: string;
  method: string;
  path: string;
}

type RequestHook<T> = (span: Span, request: T) => void;

const HTTP = '@opentelemetry/instrumentation-http';
const UNDICI = '@opentelemetry/instrumentation-undici';

/** The instrumentations whose client spans the hooks name. */
export const HTTP_CLIENT_PACKAGES = new Set([HTTP, UNDICI]);

function nameSpan(
  span: Span,
  url: URL,
  method: string,
  template: HttpClientUrlTemplate,
): void {
  const urlTemplate = template(url, method);
  if (!urlTemplate) return;
  span.setAttribute('url.template', urlTemplate);
  span.updateName(`${method} ${urlTemplate}`);
}

function isOutgoing(request: HttpRequest): request is OutgoingRequest {
  return (
    request.method !== undefined &&
    request.protocol !== undefined &&
    request.host !== undefined &&
    request.path !== undefined &&
    request.getHeader !== undefined
  );
}

/**
 * The request's URL. Node writes the full authority, port and IPv6 brackets
 * included, into the `Host` header; `host` holds the hostname alone, so it is
 * the fallback for a request sent with `setHost: false`.
 */
function outgoingUrl(request: OutgoingRequest): URL | null {
  const header = request.getHeader('host');
  const hostname = request.host.includes(':')
    ? `[${request.host}]`
    : request.host;
  const authority = header === undefined ? hostname : String(header);
  return URL.parse(request.path, `${request.protocol}//${authority}`);
}

function httpHook(
  template: HttpClientUrlTemplate,
  callerHook: RequestHook<HttpRequest> | undefined,
): RequestHook<HttpRequest> {
  return (span, request) => {
    const url = isOutgoing(request) ? outgoingUrl(request) : null;
    if (url && request.method) nameSpan(span, url, request.method, template);
    callerHook?.(span, request);
  };
}

function undiciHook(
  template: HttpClientUrlTemplate,
  callerHook: RequestHook<UndiciRequest> | undefined,
): RequestHook<UndiciRequest> {
  return (span, request) => {
    const url = URL.parse(request.path, request.origin);
    if (url) nameSpan(span, url, request.method, template);
    callerHook?.(span, request);
  };
}

/**
 * Adds the naming hook to the http and undici entries of `config`, running
 * the caller's own `requestHook` after it, so a caller's name still wins.
 */
export function withHttpClientUrlTemplate(
  config: InstrumentationSwitches,
  template: HttpClientUrlTemplate | undefined,
): InstrumentationSwitches {
  if (!template) return config;
  const http = config[HTTP] ?? {};
  const undici = config[UNDICI] ?? {};
  return {
    ...config,
    [HTTP]: {
      ...http,
      // SAFETY: the instrumentation types its own requestHook option this way.
      requestHook: httpHook(
        template,
        http.requestHook as RequestHook<HttpRequest>,
      ),
    },
    [UNDICI]: {
      ...undici,
      // SAFETY: the instrumentation types its own requestHook option this way.
      requestHook: undiciHook(
        template,
        undici.requestHook as RequestHook<UndiciRequest>,
      ),
    },
  };
}
