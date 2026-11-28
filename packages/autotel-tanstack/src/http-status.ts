import { SpanStatusCode, type SpanStatus } from '@opentelemetry/api';

/**
 * The response a request middleware's `next()` produced. TanStack Start
 * resolves it to `{ request, pathname, context, response }`, not a Response.
 */
export function responseOf(
  result: { response?: unknown } | Response | null | undefined,
): Response | undefined {
  if (result instanceof Response) return result;
  return result?.response instanceof Response ? result.response : undefined;
}

/**
 * Span status for a server response, per the HTTP conventions: a 5xx is this
 * server's error; a 4xx is the client's, so the span stays unset rather than
 * OK. Set explicitly either way, so trace.run does not mark it OK on return.
 */
export function httpServerStatus(status: number | undefined): SpanStatus {
  if (status !== undefined && status >= 500) {
    return { code: SpanStatusCode.ERROR, message: `HTTP ${status}` };
  }
  if (status !== undefined && status >= 400)
    return { code: SpanStatusCode.UNSET };
  return { code: SpanStatusCode.OK };
}
