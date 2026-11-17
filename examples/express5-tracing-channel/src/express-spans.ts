/**
 * Express 5 spans from the router's own `express.router.request` tracing
 * channel (router 2.3+): no patching, no load-order rule, and it works when
 * Express is bundled into the app.
 *
 * Each request gets a SERVER span named by its route pattern, and each
 * middleware, route handler and `router.param()` callback a child span that is
 * active while it runs, so spans the handler starts (`trace()` included) nest
 * under it.
 */
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type ContextManagementToken,
  type Span,
} from '@opentelemetry/api';
import { subscribeTracingChannel } from 'autotel/diagnostics';
import type { Request, Response } from 'express';

/** The context the router publishes, plus what this subscriber keeps on it. */
interface RouterRequest {
  req: Request;
  res: Response;
  route: string;
  handler: { name: string };
  param?: string;
  error?: unknown;
  errorHandler?: boolean;
  result?: unknown;
  span?: Span;
  token?: ContextManagementToken;
}

const tracer = trace.getTracer('express.router');

/** Each request's SERVER span context, shared by every handler it runs. */
const requests = new WeakMap<Request, Context>();
/** The route of the handler that started last: the one that handled it. */
const routes = new WeakMap<Request, string>();

function requestContext({ req, res }: RouterRequest): Context {
  const existing = requests.get(req);
  if (existing) return existing;

  const incoming = propagation.extract(context.active(), req.headers);
  const span = tracer.startSpan(
    req.method,
    {
      kind: SpanKind.SERVER,
      attributes: { 'http.request.method': req.method, 'url.path': req.path },
    },
    incoming,
  );
  res.once('finish', () => {
    const route = routes.get(req);
    if (route) {
      span.updateName(`${req.method} ${route}`);
      span.setAttribute('http.route', route);
    }
    span.setAttribute('http.response.status_code', res.statusCode);
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });

  const parent = trace.setSpan(incoming, span);
  requests.set(req, parent);
  return parent;
}

function kind(ctx: RouterRequest): string {
  if (ctx.param) return 'param';
  if (ctx.errorHandler) return 'error_handler';
  return 'handler';
}

/** Start emitting spans for Express. Returns an unsubscribe. */
export function instrumentExpress(): () => void {
  return subscribeTracingChannel<RouterRequest>('express.router.request', {
    start(ctx) {
      const parent = requestContext(ctx);
      const route = ctx.req.baseUrl + ctx.route;
      if (!ctx.errorHandler) routes.set(ctx.req, route);

      const attributes: Attributes = {
        'http.route': route,
        'express.type': kind(ctx),
      };
      if (ctx.param) attributes['express.param'] = ctx.param;
      ctx.span = tracer.startSpan(
        ctx.handler.name || '<anonymous>',
        { attributes },
        parent,
      );
      ctx.token = context.attach(trace.setSpan(parent, ctx.span));
    },
    end(ctx) {
      ctx.token?.dispose();
      // Returned synchronously; a promise ends the span in asyncEnd.
      if ('result' in ctx || 'error' in ctx) ctx.span?.end();
    },
    asyncEnd(ctx) {
      ctx.span?.end();
    },
    error(ctx) {
      const error =
        ctx.error instanceof Error ? ctx.error : new Error(String(ctx.error));
      ctx.span?.recordException(error);
      ctx.span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    },
  });
}
