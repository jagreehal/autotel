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

export interface ExpressRequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  route?: { path?: string };
  headers?: Record<string, string | string[] | undefined>;
}

export interface ExpressResponseLike {
  statusCode?: number;
}

export type ExpressNext = (err?: unknown) => void;

export interface ExpressWithAutotelOptions extends RouteAdapterOptions {
  spanName?: string | ((request: ExpressRequestLike) => string);
  requestLoggerOptions?: RequestLoggerOptions;
  enrichRequest?: (request: ExpressRequestLike) => Record<string, unknown> | undefined;
  autoEmit?: boolean;
}

const expressLoggerStorage = new AsyncLocalStorage<RequestLogger>();

function headerValue(
  headers: ExpressRequestLike['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

function enrichFromRequest(
  request?: ExpressRequestLike,
): Record<string, unknown> | undefined {
  if (!request) return undefined;

  const url = request.originalUrl ?? request.url;
  const route = request.route?.path ?? request.path ?? url;
  const requestId = headerValue(request.headers, 'x-request-id');

  return {
    ...(request.method ? { 'http.request.method': request.method } : {}),
    ...(url ? { 'url.full': url } : {}),
    ...(route ? { 'http.route': route } : {}),
    ...(requestId ? { 'http.request.id': requestId } : {}),
  };
}

const baseUseLogger = createUseLogger<ExpressRequestLike>({
  adapterName: 'express',
  enrich: enrichFromRequest,
});

export function useLogger(
  request?: ExpressRequestLike,
  requestLoggerOptions?: RequestLoggerOptions,
): RequestLogger {
  const stored = expressLoggerStorage.getStore();
  if (stored) return stored;
  return baseUseLogger(request, requestLoggerOptions);
}

const runRequest = createRequestRunner(expressLoggerStorage);

/**
 * Wrap an Express route handler. Each request opens a span, gets a
 * request-scoped logger (via `useLogger(req)`), and emits one wide event when
 * the handler settles. Thrown errors are recorded and forwarded to `next`.
 */
export function withAutotel<
  TReq extends ExpressRequestLike,
  TRes extends ExpressResponseLike,
  TReturn,
>(
  handler: (req: TReq, res: TRes, next?: ExpressNext) => TReturn | Promise<TReturn>,
  options?: ExpressWithAutotelOptions,
): (req: TReq, res: TRes, next?: ExpressNext) => Promise<TReturn | undefined> {
  return async (
    req: TReq,
    res: TRes,
    next?: ExpressNext,
  ): Promise<TReturn | undefined> => {
    const spanName =
      typeof options?.spanName === 'function'
        ? options.spanName(req)
        : (options?.spanName ?? `express.${req.method ?? 'request'}`);

    const route = req.route?.path ?? req.path ?? req.originalUrl ?? req.url ?? '/';

    try {
      return await runRequest<TReturn>(
        spanName,
        (log) => {
          const auto = enrichFromRequest(req);
          if (auto && Object.keys(auto).length > 0) log.set(auto);
          const custom = options?.enrichRequest?.(req);
          if (custom && Object.keys(custom).length > 0) log.set(custom);
        },
        () => handler(req, res, next),
        {
          ...toRouteAdapterOptions(options),
          path: route,
          requestLoggerOptions: options?.requestLoggerOptions,
          autoEmit: options?.autoEmit,
          finalize: () =>
            res.statusCode
              ? { 'http.response.status_code': res.statusCode }
              : undefined,
        },
      );
    } catch (error) {
      if (typeof next === 'function') {
        next(error);
        return undefined;
      }
      throw error;
    }
  };
}

export { parseError, createDrainPipeline, createStructuredError };
