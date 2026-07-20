import {
  createDrainPipeline,
  createStructuredError,
  parseError,
  type RequestLogger,
  type RequestLoggerOptions,
} from 'autotel';
import {
  createUseLogger,
  getHeader,
  type FrameworkHandlerOptions,
} from './core';
import {
  applyLoggerEnrichment,
  defineFrameworkIntegration,
  runWithIntegratedHandle,
  buildTracedOptions,
} from './toolkit/integration';

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

export interface CloudflareHandlerContext<
  TEnv,
  TRequest extends CloudflareRequestLike,
  TContext extends CloudflareExecutionContextLike,
> {
  request: TRequest;
  env: TEnv;
  executionContext: TContext;
}

export interface CloudflareWithAutotelOptions<TEnv = unknown>
  extends Omit<FrameworkHandlerOptions, 'spanName'> {
  spanName?: string | ((request: CloudflareRequestLike, env: TEnv) => string);
  enrichRequest?: (
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

function resolvePath(request: CloudflareRequestLike): string {
  if (!request.url) return '/';
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

function createIntegration<TEnv>() {
  return defineFrameworkIntegration<
    CloudflareHandlerContext<TEnv, CloudflareRequestLike, CloudflareExecutionContextLike>
  >({
    name: 'cloudflare',
    extractRequest: ({ request }) => ({
      method: request.method ?? 'GET',
      path: resolvePath(request),
      headers: request.headers,
      requestId:
        getHeader(request.headers, 'x-request-id') ??
        getHeader(request.headers, 'cf-ray'),
    }),
    attachLogger: ({ request }, logger) => {
      requestLoggers.set(request as object, logger);
    },
    extractWaitUntil: ({ executionContext }) => {
      const waitUntil =
        typeof executionContext.waitUntil === 'function'
          ? executionContext.waitUntil.bind(executionContext)
          : undefined;
      return waitUntil;
    },
  });
}

const integration = createIntegration<unknown>();

function resolveSpanName<TEnv>(
  request: CloudflareRequestLike,
  env: TEnv,
  options?: CloudflareWithAutotelOptions<TEnv>,
): string {
  if (typeof options?.spanName === 'function') {
    return options.spanName(request, env);
  }
  return options?.spanName ?? `cloudflare.${request.method ?? 'request'}`;
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
    const ctx = { request, env, executionContext };
    try {
      return await integration.runTraced(
        ctx,
        buildTracedOptions(options, resolveSpanName(request, env, options)),
        async (handle) =>
          runWithIntegratedHandle(handle, options, async () => {
            applyLoggerEnrichment(
              handle.logger,
              enrichFromRequest(request),
              options?.enrichRequest?.(request, env, executionContext),
            );
            return handler(request, env, executionContext);
          }),
      );
    } finally {
      requestLoggers.delete(request as object);
    }
  };
}

export { parseError, createDrainPipeline, createStructuredError };
