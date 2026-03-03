import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createDrainPipeline,
  getRequestLogger,
  parseError,
  trace,
  createStructuredError,
  type RequestLogger,
  type RequestLoggerOptions,
  type ParsedError,
  type DrainPipelineOptions,
  type PipelineDrainFn,
  type StructuredError,
  type StructuredErrorInput,
} from 'autotel';
import { createAdapterToolkit, createUseLogger, getHeader } from './core';

export interface NextRequestLike {
  method?: string;
  url?: string;
  headers?:
    | { get(name: string): string | null }
    | Record<string, string | undefined>;
}

export interface NextWithAutotelOptions {
  spanName?: string | ((request?: NextRequestLike) => string);
  requestLoggerOptions?: RequestLoggerOptions;
  enrich?: (request?: NextRequestLike) => Record<string, unknown> | undefined;
}

const nextLoggerStorage = new AsyncLocalStorage<RequestLogger>();

function enrichFromRequest(
  request?: NextRequestLike,
): Record<string, unknown> | undefined {
  if (!request) return undefined;

  let route = '/';
  if (request.url) {
    try {
      route = new URL(request.url).pathname;
    } catch {
      route = request.url;
    }
  }
  const requestId = getHeader(request.headers, 'x-request-id');

  return {
    ...(request.method ? { 'http.request.method': request.method } : {}),
    ...(request.url ? { 'url.full': request.url } : {}),
    ...(route ? { 'http.route': route } : {}),
    ...(requestId ? { 'http.request.header.x-request-id': requestId } : {}),
  };
}

const baseUseLogger = createUseLogger<NextRequestLike>({
  adapterName: 'next',
  enrich: enrichFromRequest,
});

export function useLogger(
  request?: NextRequestLike,
  requestLoggerOptions?: RequestLoggerOptions,
): RequestLogger {
  const logger = nextLoggerStorage.getStore();
  if (logger) return logger;
  return baseUseLogger(request, requestLoggerOptions);
}

export function withAutotel<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => TReturn | Promise<TReturn>,
  options?: NextWithAutotelOptions,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const request = args[0] as NextRequestLike | undefined;
    const spanName =
      typeof options?.spanName === 'function'
        ? options.spanName(request)
        : (options?.spanName ?? 'next.request');

    const wrapped = trace(
      { name: spanName },
      (ctx) => async (...innerArgs: TArgs) => {
        const innerRequest = innerArgs[0] as NextRequestLike | undefined;
        const log = getRequestLogger(ctx, options?.requestLoggerOptions);
        const auto = enrichFromRequest(innerRequest);
        if (auto && Object.keys(auto).length > 0) {
          log.set(auto);
        }
        const custom = options?.enrich?.(innerRequest);
        if (custom && Object.keys(custom).length > 0) {
          log.set(custom);
        }
        return await nextLoggerStorage.run(log, async () => handler(...innerArgs));
      },
    );
    return await wrapped(...args);
  };
}

export function createNextAdapter(options?: NextWithAutotelOptions) {
  return {
    withAutotel: <TArgs extends unknown[], TReturn>(
      handler: (...args: TArgs) => TReturn | Promise<TReturn>,
    ) => withAutotel(handler, options),
    useLogger: (
      request?: NextRequestLike,
      requestLoggerOptions?: RequestLoggerOptions,
    ): RequestLogger => useLogger(request, requestLoggerOptions),
    parseError: (error: unknown): ParsedError => parseError(error),
    createStructuredError: (
      input: StructuredErrorInput,
    ): StructuredError => createStructuredError(input),
    createDrainPipeline: <T = unknown>(
      drainOptions?: DrainPipelineOptions<T>,
    ): ((batchDrain: (batch: T[]) => void | Promise<void>) => PipelineDrainFn<T>) =>
      createDrainPipeline(drainOptions),
  };
}

export const nextToolkit = createAdapterToolkit<NextRequestLike>({
  adapterName: 'next',
  enrich: enrichFromRequest,
});

export { parseError, createDrainPipeline, createStructuredError };
