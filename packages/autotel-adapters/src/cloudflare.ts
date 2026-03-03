import {
  createDrainPipeline,
  createStructuredError,
  getRequestLogger,
  parseError,
  trace,
  type DrainPipelineOptions,
  type ParsedError,
  type PipelineDrainFn,
  type RequestLogger,
  type RequestLoggerOptions,
  type StructuredError,
  type StructuredErrorInput,
} from 'autotel';
import { createAdapterToolkit, createUseLogger, getHeader } from './core';

export interface CloudflareRequestLike {
  method?: string;
  url?: string;
  headers?:
    | { get(name: string): string | null }
    | Record<string, string | undefined>;
  cf?: Record<string, unknown>;
}

export interface CloudflareExecutionContextLike {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
}

export interface CloudflareWithAutotelOptions<TEnv = unknown> {
  spanName?: string | ((request: CloudflareRequestLike, env: TEnv) => string);
  requestLoggerOptions?: RequestLoggerOptions;
  enrich?: (
    request: CloudflareRequestLike,
    env: TEnv,
    ctx: CloudflareExecutionContextLike,
  ) => Record<string, unknown> | undefined;
}

const requestLoggers = new WeakMap<object, RequestLogger>();

function enrichFromRequest(
  request?: CloudflareRequestLike,
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

  const requestId =
    getHeader(request.headers, 'x-request-id') ??
    getHeader(request.headers, 'cf-ray');

  return {
    ...(request.method ? { 'http.request.method': request.method } : {}),
    ...(request.url ? { 'url.full': request.url } : {}),
    ...(route ? { 'http.route': route } : {}),
    ...(requestId ? { 'http.request.id': requestId } : {}),
    ...(request.cf?.country ? { 'cloudflare.country': request.cf.country } : {}),
    ...(request.cf?.colo ? { 'cloudflare.colo': request.cf.colo } : {}),
    ...(request.cf?.city ? { 'cloudflare.city': request.cf.city } : {}),
  };
}

const baseUseLogger = createUseLogger<CloudflareRequestLike>({
  adapterName: 'cloudflare',
  enrich: enrichFromRequest,
});

export function useLogger(
  request?: CloudflareRequestLike,
  requestLoggerOptions?: RequestLoggerOptions,
): RequestLogger {
  if (request) {
    const existing = requestLoggers.get(request as object);
    if (existing) return existing;
  }
  return baseUseLogger(request, requestLoggerOptions);
}

export function withAutotelFetch<
  TEnv,
  TRequest extends CloudflareRequestLike,
  TContext extends CloudflareExecutionContextLike,
  TReturn,
>(
  handler: (
    request: TRequest,
    env: TEnv,
    ctx: TContext,
  ) => TReturn | Promise<TReturn>,
  options?: CloudflareWithAutotelOptions<TEnv>,
): (
  request: TRequest,
  env: TEnv,
  ctx: TContext,
) => Promise<TReturn> {
  return async (
    request: TRequest,
    env: TEnv,
    executionContext: TContext,
  ): Promise<TReturn> => {
    const spanName =
      typeof options?.spanName === 'function'
        ? options.spanName(request, env)
        : (options?.spanName ?? `cloudflare.${request.method ?? 'request'}`);

    const wrapped = trace(
      { name: spanName },
      (ctx) => async (
        innerRequest: TRequest,
        innerEnv: TEnv,
        innerExecutionContext: TContext,
      ) => {
        const log = getRequestLogger(ctx, options?.requestLoggerOptions);
        const auto = enrichFromRequest(innerRequest);
        if (auto && Object.keys(auto).length > 0) {
          log.set(auto);
        }
        const custom = options?.enrich?.(
          innerRequest,
          innerEnv,
          innerExecutionContext,
        );
        if (custom && Object.keys(custom).length > 0) {
          log.set(custom);
        }

        requestLoggers.set(innerRequest as object, log);
        try {
          return await handler(innerRequest, innerEnv, innerExecutionContext);
        } finally {
          requestLoggers.delete(innerRequest as object);
        }
      },
    );

    return await wrapped(request, env, executionContext);
  };
}

export function createCloudflareAdapter<TEnv = unknown>(
  options?: CloudflareWithAutotelOptions<TEnv>,
) {
  return {
    withAutotelFetch: <
      TRequest extends CloudflareRequestLike,
      TContext extends CloudflareExecutionContextLike,
      TReturn,
    >(
      handler: (
        request: TRequest,
        env: TEnv,
        ctx: TContext,
      ) => TReturn | Promise<TReturn>,
    ) => withAutotelFetch(handler, options),
    useLogger,
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

export const cloudflareToolkit = createAdapterToolkit<CloudflareRequestLike>({
  adapterName: 'cloudflare',
  enrich: enrichFromRequest,
});

export { parseError, createDrainPipeline, createStructuredError };
