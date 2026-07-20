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
  headers?:
    | Headers
    | Record<string, string | string[] | undefined>
    | { get(name: string): string | null };
  requestId?: string;
}

export interface IntegratedCompletionOptions {
  autoEmit?: boolean;
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
  if (handle.skipped || options?.autoEmit === false) {
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
      await handle.finish({
        error: error instanceof Error ? error : new Error(String(error)),
      });
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
  spanName: string,
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
  return `http.${request.method.toLowerCase() || 'request'}`;
}

function buildHandle<TCtx>(
  spec: FrameworkIntegrationSpec<TCtx>,
  ctx: TCtx,
  traceCtx: TraceContext,
  options: FrameworkHandlerOptions = {},
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
    'http.route': extracted.path,
    ...(extracted.requestId ? { 'http.request.id': extracted.requestId } : {}),
  });

  if (spec.storage) {
    attachForkToLogger(
      log,
      spec.forkLifecycle ?? createStorageForkLifecycle(spec.storage),
    );
  }

  spec.attachLogger(ctx, log);

  const result = createMiddlewareLogger(log, middlewareOptions);
  const storage = spec.storage;

  return {
    ...result,
    middlewareOptions,
    runWith: async (fn) => {
      if (!storage || result.skipped) return fn();
      return storage.run(log, fn);
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
    finish: async () => null,
    finishResponse: async (response) => response,
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

    runTraced(ctx, options, handler) {
      const extracted = spec.extractRequest(ctx);
      if (
        !shouldInstrumentPath(extracted.path, toRouteAdapterOptions(options))
      ) {
        return handler(buildSkippedHandle(spec, ctx, extracted, options));
      }

      const spanName =
        options?.spanName ?? resolveSpanName(spec, ctx, extracted);

      return trace({ name: spanName }, (traceCtx) => async () => {
        const handle = buildHandle(spec, ctx, traceCtx, options ?? {});
        return handler(handle);
      })();
    },
  };
}
