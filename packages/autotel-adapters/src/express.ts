import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createDrainPipeline,
  createStructuredError,
  parseError,
  type DrainPipelineOptions,
  type ParsedError,
  type PipelineDrainFn,
  type RequestLogger,
  type RequestLoggerOptions,
  type StructuredError,
  type StructuredErrorInput,
} from 'autotel';
import {
  createAdapterToolkit,
  createRequestRunner,
  createUseLogger,
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

export interface ExpressWithAutotelOptions {
  spanName?: string | ((request: ExpressRequestLike) => string);
  requestLoggerOptions?: RequestLoggerOptions;
  enrich?: (request: ExpressRequestLike) => Record<string, unknown> | undefined;
  /** Emit one wide event automatically when the handler settles. Default `true`. */
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

    try {
      return await runRequest<TReturn>(
        spanName,
        (log) => {
          const auto = enrichFromRequest(req);
          if (auto && Object.keys(auto).length > 0) log.set(auto);
          const custom = options?.enrich?.(req);
          if (custom && Object.keys(custom).length > 0) log.set(custom);
        },
        () => handler(req, res, next),
        {
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

export function createExpressAdapter(options?: ExpressWithAutotelOptions) {
  return {
    withAutotel: <
      TReq extends ExpressRequestLike,
      TRes extends ExpressResponseLike,
      TReturn,
    >(
      handler: (
        req: TReq,
        res: TRes,
        next?: ExpressNext,
      ) => TReturn | Promise<TReturn>,
    ) => withAutotel(handler, options),
    useLogger,
    parseError: (error: unknown): ParsedError => parseError(error),
    createStructuredError: (input: StructuredErrorInput): StructuredError =>
      createStructuredError(input),
    createDrainPipeline: <T = unknown>(
      drainOptions?: DrainPipelineOptions<T>,
    ): ((batchDrain: (batch: T[]) => void | Promise<void>) => PipelineDrainFn<T>) =>
      createDrainPipeline(drainOptions),
  };
}

export const expressToolkit = createAdapterToolkit<ExpressRequestLike>({
  adapterName: 'express',
  enrich: enrichFromRequest,
});

export { parseError, createDrainPipeline, createStructuredError };
