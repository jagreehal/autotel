import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createDrainPipeline,
  createStructuredError,
  parseError,
  type RequestLogger,
  type RequestLoggerOptions,
} from 'autotel';
import {
  createRequestRunner,
  createUseLogger,
  toRouteAdapterOptions,
  type RouteAdapterOptions,
} from './core';

export interface FastifyRequestLike {
  method?: string;
  url?: string;
  routeOptions?: { url?: string };
  routerPath?: string;
  id?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface FastifyReplyLike {
  statusCode?: number;
}

export interface FastifyWithAutotelOptions extends RouteAdapterOptions {
  spanName?: string | ((request: FastifyRequestLike) => string);
  requestLoggerOptions?: RequestLoggerOptions;
  enrichRequest?: (request: FastifyRequestLike) => Record<string, unknown> | undefined;
  autoEmit?: boolean;
}

const fastifyLoggerStorage = new AsyncLocalStorage<RequestLogger>();

function headerValue(
  headers: FastifyRequestLike['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

function enrichFromRequest(
  request?: FastifyRequestLike,
): Record<string, unknown> | undefined {
  if (!request) return undefined;

  const route = request.routeOptions?.url ?? request.routerPath ?? request.url;
  const requestId = request.id ?? headerValue(request.headers, 'x-request-id');

  return {
    ...(request.method ? { 'http.request.method': request.method } : {}),
    ...(request.url ? { 'url.full': request.url } : {}),
    ...(route ? { 'http.route': route } : {}),
    ...(requestId ? { 'http.request.id': requestId } : {}),
  };
}

const baseUseLogger = createUseLogger<FastifyRequestLike>({
  adapterName: 'fastify',
  enrich: enrichFromRequest,
});

export function useLogger(
  request?: FastifyRequestLike,
  requestLoggerOptions?: RequestLoggerOptions,
): RequestLogger {
  const stored = fastifyLoggerStorage.getStore();
  if (stored) return stored;
  return baseUseLogger(request, requestLoggerOptions);
}

const runRequest = createRequestRunner(fastifyLoggerStorage);

/**
 * Wrap a Fastify route handler. Each request opens a span, gets a
 * request-scoped logger (via `useLogger(request)`), and emits one wide event
 * when the handler settles. Thrown errors are recorded, then rethrown for
 * Fastify's error handling.
 */
export function withAutotel<
  TReq extends FastifyRequestLike,
  TRes extends FastifyReplyLike,
  TReturn,
>(
  handler: (request: TReq, reply: TRes) => TReturn | Promise<TReturn>,
  options?: FastifyWithAutotelOptions,
): (request: TReq, reply: TRes) => Promise<TReturn> {
  return (request: TReq, reply: TRes): Promise<TReturn> => {
    const spanName =
      typeof options?.spanName === 'function'
        ? options.spanName(request)
        : (options?.spanName ?? `fastify.${request.method ?? 'request'}`);

    const route =
      request.routeOptions?.url ?? request.routerPath ?? request.url ?? '/';

    return runRequest<TReturn>(
      spanName,
      (log) => {
        const auto = enrichFromRequest(request);
        if (auto && Object.keys(auto).length > 0) log.set(auto);
        const custom = options?.enrichRequest?.(request);
        if (custom && Object.keys(custom).length > 0) log.set(custom);
      },
      () => handler(request, reply),
      {
        ...toRouteAdapterOptions(options),
        path: route,
        requestLoggerOptions: options?.requestLoggerOptions,
        autoEmit: options?.autoEmit,
        finalize: () =>
          reply.statusCode
            ? { 'http.response.status_code': reply.statusCode }
            : undefined,
      },
    );
  };
}

export { parseError, createDrainPipeline, createStructuredError };
