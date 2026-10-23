import type { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ForkLifecycle,
  RequestLogger,
  RequestLoggerOptions,
  TraceContext,
} from 'autotel';
import { createNoopRequestLogger, getRequestLogger, trace } from 'autotel';
import { attachForkToLogger } from './fork';
import { createStorageForkLifecycle } from './storage';
import {
  createMiddlewareLogger,
  mergeRequestLoggerOptions,
  shouldInstrumentPath,
  type MiddlewareLoggerOptions,
  type MiddlewareLoggerResult,
  type RouteAdapterOptions,
} from './middleware';

export interface ExtractedRequest {
  method: string;
  path: string;
  /** Matched route template (`/users/:id`), never the raw path. Omit when unknown. */
  route?: string;
  headers?:
    | Headers
    | Record<string, string | string[] | undefined>
    | { get(name: string): string | null };
  requestId?: string;
}

export interface IntegratedCompletionOptions {
  autoEmit?: boolean;
  /** Return false for framework control-flow throws that are not failures. */
  isError?: (cause: unknown) => boolean;
}

export type TracedOptionInput = RouteAdapterOptions & {
  requestLoggerOptions?: RequestLoggerOptions;
  autoEmit?: boolean;
};

export interface FrameworkHandlerOptions extends TracedOptionInput {
  spanName?: string;
}

export interface FrameworkIntegrationSpec<TCtx> {
  name: string;
  extractRequest: (ctx: TCtx) => ExtractedRequest;
  attachLogger: (ctx: TCtx, logger: RequestLogger) => void;
  storage?: AsyncLocalStorage<RequestLogger>;
  forkLifecycle?: ForkLifecycle;
  extractWaitUntil?: (
    ctx: TCtx,
  ) => ((promise: Promise<unknown>) => void) | undefined;
  spanName?: string | ((ctx: TCtx, request: ExtractedRequest) => string);
}

export interface FrameworkRequestHandle extends MiddlewareLoggerResult {
  middlewareOptions: MiddlewareLoggerOptions;
  runWith: <T>(fn: () => T | Promise<T>) => Promise<T>;
  /** Record a route template only known after routing (sets `http.route`, renames a default-named span). */
  setRoute: (route: string | undefined) => void;
}

export interface FrameworkIntegrationHelpers<TCtx> {
  begin: (
    traceCtx: TraceContext,
    ctx: TCtx,
    options?: FrameworkHandlerOptions,
  ) => FrameworkRequestHandle;
  runTraced: <T>(
    ctx: TCtx,
    options: FrameworkHandlerOptions | undefined,
    handler: (handle: FrameworkRequestHandle) => Promise<T>,
    completion?: Pick<IntegratedCompletionOptions, 'isError'>,
  ) => Promise<T>;
}

export function applyLoggerEnrichment(
  logger: RequestLogger,
  ...attributeSets: Array<Record<string, unknown> | undefined | null>
): void {
  for (const attrs of attributeSets) {
    if (attrs && Object.keys(attrs).length > 0) {
      logger.set(attrs);
    }
  }
}

export async function completeIntegratedRequest<T>(
  handle: FrameworkRequestHandle,
  options: IntegratedCompletionOptions | undefined,
  result: T,
): Promise<T> {
  if (handle.skipped) return result;
  if (options?.autoEmit === false) {
    // No snapshot, but the span still says how the request ended.
    if (result instanceof Response)
      handle.markOutcome({ status: result.status });
    return result;
  }

  if (result instanceof Response) {
    return handle.finishResponse(result) as unknown as T;
  }

  await handle.finish({});
  return result;
}

export async function runWithIntegratedHandle<T>(
  handle: FrameworkRequestHandle,
  options: IntegratedCompletionOptions | undefined,
  fn: () => T | Promise<T>,
): Promise<T> {
  if (handle.skipped) {
    return handle.runWith(fn);
  }

  try {
    const result = await handle.runWith(fn);
    return completeIntegratedRequest(handle, options, result);
  } catch (error) {
    if (options?.autoEmit !== false) {
      if (options?.isError?.(error) === false) {
        await handle.finish({});
      } else {
        await handle.finish({
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
    throw error;
  }
}

export function toRouteAdapterOptions(
  options?: Pick<
    FrameworkHandlerOptions,
    keyof RouteAdapterOptions | 'requestLoggerOptions'
  >,
): RouteAdapterOptions {
  if (!options) return {};
  const { include, exclude, routes, waitUntil, keep, requestLoggerOptions } =
    options;
  return { include, exclude, routes, waitUntil, keep, requestLoggerOptions };
}

export function buildTracedOptions(
  options: TracedOptionInput | undefined,
  spanName: string | undefined,
): FrameworkHandlerOptions {
  return {
    ...toRouteAdapterOptions(options),
    requestLoggerOptions: options?.requestLoggerOptions,
    autoEmit: options?.autoEmit,
    spanName,
  };
}

function resolveSpanName<TCtx>(
  spec: FrameworkIntegrationSpec<TCtx>,
  ctx: TCtx,
  request: ExtractedRequest,
): string {
  if (typeof spec.spanName === 'function') {
    return spec.spanName(ctx, request);
  }
  if (typeof spec.spanName === 'string') {
    return spec.spanName;
  }
  return defaultSpanName(request.method, request.route);
}

/** OTel HTTP server span name: `{method} {http.route}`, or `{method}` without a route. */
export function defaultSpanName(
  method: string | undefined,
  route: string | undefined,
): string {
  const m = method || 'HTTP';
  return route ? `${m} ${route}` : m;
}

function buildHandle<TCtx>(
  spec: FrameworkIntegrationSpec<TCtx>,
  ctx: TCtx,
  traceCtx: TraceContext,
  options: FrameworkHandlerOptions = {},
  defaultNamed = false,
): FrameworkRequestHandle {
  const extracted = spec.extractRequest(ctx);
  const waitUntil = options.waitUntil ?? spec.extractWaitUntil?.(ctx);
  const middlewareOptions: MiddlewareLoggerOptions = {
    method: extracted.method,
    path: extracted.path,
    requestId: extracted.requestId,
    ...toRouteAdapterOptions(options),
    waitUntil,
    requestLoggerOptions: mergeRequestLoggerOptions(
      options.requestLoggerOptions,
      waitUntil,
    ),
  };

  const log = getRequestLogger(
    traceCtx,
    middlewareOptions.requestLoggerOptions,
  );
  log.set({
    'http.request.method': extracted.method,
    'url.path': extracted.path,
    'http.route': extracted.route,
    'http.request.id': extracted.requestId,
  });

  if (spec.storage) {
    attachForkToLogger(
      log,
      spec.forkLifecycle ?? createStorageForkLifecycle(spec.storage),
    );
  }

  spec.attachLogger(ctx, log);

  const result = createMiddlewareLogger(log, middlewareOptions, traceCtx);
  const storage = spec.storage;

  return {
    ...result,
    middlewareOptions,
    runWith: async (fn) => {
      if (!storage || result.skipped) return fn();
      return storage.run(log, fn);
    },
    setRoute: (route) => {
      if (!route) return;
      log.set({ 'http.route': route });
      if (defaultNamed) {
        traceCtx.updateName(defaultSpanName(extracted.method, route));
      }
    },
  };
}

function buildSkippedHandle<TCtx>(
  spec: FrameworkIntegrationSpec<TCtx>,
  ctx: TCtx,
  extracted: ExtractedRequest,
  options: FrameworkHandlerOptions = {},
): FrameworkRequestHandle {
  const waitUntil = options.waitUntil ?? spec.extractWaitUntil?.(ctx);
  const middlewareOptions: MiddlewareLoggerOptions = {
    method: extracted.method,
    path: extracted.path,
    requestId: extracted.requestId,
    ...toRouteAdapterOptions(options),
    waitUntil,
  };

  const logger = createNoopRequestLogger();
  spec.attachLogger(ctx, logger);

  return {
    logger,
    middlewareOptions,
    skipped: true,
    markOutcome: () => {},
    finish: async () => null,
    finishResponse: async (response) => response,
    setRoute: () => {},
    runWith: async (fn) => {
      if (!spec.storage) return fn();
      return spec.storage.run(logger, fn);
    },
  };
}

export function defineFrameworkIntegration<TCtx>(
  spec: FrameworkIntegrationSpec<TCtx>,
): FrameworkIntegrationHelpers<TCtx> {
  return {
    begin(traceCtx, ctx, options = {}) {
      const extracted = spec.extractRequest(ctx);
      if (
        !shouldInstrumentPath(extracted.path, toRouteAdapterOptions(options))
      ) {
        return buildSkippedHandle(spec, ctx, extracted, options);
      }
      return buildHandle(spec, ctx, traceCtx, options);
    },

    runTraced(ctx, options, handler, completion) {
      const extracted = spec.extractRequest(ctx);
      if (
        !shouldInstrumentPath(extracted.path, toRouteAdapterOptions(options))
      ) {
        return handler(buildSkippedHandle(spec, ctx, extracted, options));
      }

      const spanName =
        options?.spanName ?? resolveSpanName(spec, ctx, extracted);
      const defaultNamed = !options?.spanName && !spec.spanName;

      return trace.run(
        { name: spanName, isError: completion?.isError },
        (traceCtx) => {
          const handle = buildHandle(
            spec,
            ctx,
            traceCtx,
            options ?? {},
            defaultNamed,
          );
          return handler(handle);
        },
      ) as ReturnType<typeof handler>;
    },
  };
}
