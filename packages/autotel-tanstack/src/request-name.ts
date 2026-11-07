import type { Attributes } from '@opentelemetry/api';
import { setHttpServerRoute } from 'autotel';
import { SPAN_ATTRIBUTES, type RouteMatcher } from './types';

/**
 * TanStack Start serves every server function under `/_serverFn`, after the
 * app's basepath when it has one: the route is everything up to that segment.
 */
const SERVER_FN_PATH = /^(.*\/_serverFn)\/(.+)$/;

/** What a request span is called and what it carries. */
export interface RequestSpan {
  name: string;
  attributes: Attributes;
}

/**
 * Span name and attributes for an incoming request. A server function's path
 * ends in a build hash that changes on every deploy, so those requests share
 * one name and route, with the function id kept as an attribute. Other
 * requests take the route `router` matches, in TanStack's own syntax
 * (`/posts/$postId`), or their path when it matches none. A route also goes
 * to the HTTP server span.
 */
export function requestSpan(
  method: string,
  requestUrl: URL,
  router?: RouteMatcher,
): RequestSpan {
  const requestPath = requestUrl.pathname;
  const serverFn = SERVER_FN_PATH.exec(requestPath);

  if (serverFn) {
    return routed(method, serverFn[1]!, {
      [SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_NAME]: serverFn[2]!,
    });
  }

  const matched =
    router && matchedRoute(router, routerPath(router, requestUrl));

  if (!matched) return { name: `${method} ${requestPath}`, attributes: {} };

  // http.route is the template from the server's root, mount point included.
  const mount = router?.basepath?.replace(/\/+$/, '') ?? '';
  return routed(method, mount && matched === '/' ? mount : mount + matched);
}

/**
 * The route a path matches in full. The router matches loosely, returning the
 * deepest partial match with the rest under the `**` param, so a 404 under
 * `/posts/$postId` would take that route; a partial match counts as none.
 */
function matchedRoute(
  router: RouteMatcher,
  pathname: string,
): string | undefined {
  const [, params, found] = router.getMatchedRoutes(pathname);
  return '**' in params ? undefined : found?.fullPath;
}

/**
 * The path as the router sees it: with its `basepath` removed, so `/app/posts/1`
 * under basepath `/app` matches `/posts/$postId`. Uses the router's own input
 * rewrite on the full request URL, host and query included, as the router
 * does. The rewrite may edit the URL in place, so it gets a copy.
 */
function routerPath(router: RouteMatcher, requestUrl: URL): string {
  const url = new URL(requestUrl);
  const rewritten = router.rewrite?.input?.({ url });
  if (rewritten instanceof URL) return rewritten.pathname;
  if (rewritten) return new URL(rewritten, url).pathname;
  return url.pathname;
}

function routed(
  method: string,
  route: string,
  attributes: Attributes = {},
): RequestSpan {
  setHttpServerRoute(route);

  return {
    name: `${method} ${route}`,
    attributes: { ...attributes, [SPAN_ATTRIBUTES.HTTP_ROUTE]: route },
  };
}
