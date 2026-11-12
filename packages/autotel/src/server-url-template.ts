/**
 * Names an HTTP server span rejected before any route was recorded.
 *
 * `instrumentation-http` names a server span `METHOD route` only when a
 * framework recorded the route. A request rejected before the router ran,
 * such as a 401 from auth middleware, keeps the bare `GET`, and a backend
 * cannot group it by endpoint. Such a span is named from its path with id
 * segments replaced (`GET /users/:id/clients`) and carries `url.template`,
 * while `http.route` stays unset, so a templated path is never mistaken for a
 * matched route.
 *
 * Only failed responses (4xx, 5xx) are named. A 404 keeps `METHOD`: its path
 * names no endpoint, and scanners send a new one every request. A success
 * without a route (a server with no router) keeps it too, because there every
 * path, slugs included, would become a name of its own.
 *
 * Auth middleware that answers 401 on every path lets a scanner mint names
 * too; `ignoreIncomingRequestHook` filters those requests.
 */

import type { Span } from '@opentelemetry/api';
import type { InstrumentationSwitches } from './auto-instrumentations';
import { asRecord } from './values';

const HTTP = '@opentelemetry/instrumentation-http';

/** A MongoDB ObjectId, a UUID, a number: the same set autotel-web replaces. */
const ID_SEGMENTS = [
  /^[0-9a-f]{24}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d+$/,
];

/** `/users/507f1f77bcf86cd799439011/x?y=1` → `/users/:id/x`. */
export function serverUrlTemplate(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path
    .split('/')
    .map((segment) =>
      segment && ID_SEGMENTS.some((pattern) => pattern.test(segment))
        ? ':id'
        : segment,
    )
    .join('/');
}

/** Hooks already wrapped, so applying the defaults twice is a no-op. */
const wrapped = new WeakSet<CustomAttributesHook>();

type CustomAttributesHook = (
  span: Span,
  request: unknown,
  response: unknown,
) => void;

/** The parts of an `IncomingMessage` / `ServerResponse` the hook reads. */
interface ServerExchange {
  request: { method?: string; url?: string };
  response: { statusCode: number };
}

/**
 * A server exchange, told apart from a client one by the response: only a
 * `ServerResponse` has `writeHead`.
 */
function serverExchange(
  request: unknown,
  response: unknown,
): ServerExchange | undefined {
  const res = asRecord(response);
  const req = asRecord(request);
  if (!req || !res || typeof res.writeHead !== 'function') return undefined;
  if (typeof res.statusCode !== 'number') return undefined;
  return {
    request: {
      method: typeof req.method === 'string' ? req.method : undefined,
      url: typeof req.url === 'string' ? req.url : undefined,
    },
    response: { statusCode: res.statusCode },
  };
}

/** The SDK span's attributes; the API `Span` has no getter for them. */
function recordedRoute(span: Span): unknown {
  return asRecord(asRecord(span)?.attributes)?.['http.route'];
}

export function nameUnroutedServerSpan(
  span: Span,
  request: unknown,
  response: unknown,
): void {
  const exchange = serverExchange(request, response);
  const status = exchange?.response.statusCode ?? 0;
  if (!exchange || status < 400 || status === 404) return;
  if (recordedRoute(span)) return;
  const { method = 'GET', url } = exchange.request;
  if (!url) return;
  const template = serverUrlTemplate(url);
  if (!template || template === '/') return;
  span.setAttribute('url.template', template);
  span.updateName(`${method} ${template}`);
}

/**
 * Adds {@link nameUnroutedServerSpan} to the http entry of `config`, running
 * the caller's own `applyCustomAttributesOnSpan` after it, so a caller's name
 * still wins.
 */
export function withUnroutedServerNames(
  config: InstrumentationSwitches,
): InstrumentationSwitches {
  const http = config[HTTP];
  if (http?.enabled === false) return config;
  // SAFETY: the instrumentation types its own hook option this way.
  const callerHook = http?.applyCustomAttributesOnSpan as
    CustomAttributesHook | undefined;
  if (callerHook && wrapped.has(callerHook)) return config;
  const hook: CustomAttributesHook = (span, request, response) => {
    nameUnroutedServerSpan(span, request, response);
    callerHook?.(span, request, response);
  };
  wrapped.add(hook);
  return {
    ...config,
    [HTTP]: { ...http, applyCustomAttributesOnSpan: hook },
  };
}
