import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';

/**
 * Hand a matched route template, such as `/users/:id`, to the HTTP server span
 * `@opentelemetry/instrumentation-http` opened for this request. That span
 * sets `http.route` from it and is renamed `METHOD route` when the response
 * ends, which is what lets a trace be joined to the API operation it served.
 * A framework span inside the request cannot do that for the server span.
 *
 * `keepExisting` leaves a route already recorded in place, such as the full
 * template `@opentelemetry/instrumentation-express` builds across nested
 * routers.
 *
 * Returns whether the route was handed: false when no HTTP server span is
 * listening (outside a request, or without the HTTP instrumentation) or when
 * `keepExisting` kept an earlier route.
 */
export function setHttpServerRoute(
  route: string,
  options: { keepExisting?: boolean } = {},
): boolean {
  const metadata = getRPCMetadata(context.active());

  if (metadata?.type !== RPCType.HTTP) return false;
  if (options.keepExisting && metadata.route) return false;

  metadata.route = route;

  return true;
}
