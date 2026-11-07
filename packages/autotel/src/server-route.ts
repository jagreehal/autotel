import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';

/**
 * Hand a matched route template, such as `/users/:id`, to the HTTP server span
 * `@opentelemetry/instrumentation-http` opened for this request. That span
 * sets `http.route` from it and is renamed `METHOD route` when the response
 * ends, which is what lets a trace be joined to the API operation it served.
 * A framework span inside the request cannot do that for the server span.
 *
 * Returns false when no HTTP server span is listening, such as outside a
 * request or without the HTTP instrumentation.
 */
export function setHttpServerRoute(route: string): boolean {
  const metadata = getRPCMetadata(context.active());

  if (metadata?.type !== RPCType.HTTP) return false;

  metadata.route = route;

  return true;
}
