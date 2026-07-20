import type {
  ForkLifecycle,
  RequestLogger,
  RequestLoggerOptions,
  RequestLogSnapshot,
} from 'autotel';
import { createNoopRequestLogger } from 'autotel';
import type { RouteFilterOptions, RouteServiceConfig } from 'autotel-edge';
import {
  getServiceForPath,
  matchesRoutePattern,
  shouldInstrumentPath,
} from 'autotel-edge';
import { extendDeferredDrain } from './deferred-drain';
import {
  bindStreamingResponseLifecycle,
  shouldDeferEmitForResponse,
} from './stream-response';

export type Awaitable<T> = T | Promise<T>;

export type { RouteFilterOptions, RouteServiceConfig };
export { getServiceForPath, matchesRoutePattern, shouldInstrumentPath };

export interface RouteAdapterOptions {
  include?: string[];
  exclude?: string[];
  routes?: Record<string, RouteServiceConfig>;
  waitUntil?: (promise: Promise<unknown>) => void;
  keep?: (ctx: TailSamplingContext) => Awaitable<void>;
  requestLoggerOptions?: RequestLoggerOptions;
}

/** @deprecated Use {@link RouteAdapterOptions}. */
export type BaseAdapterOptions = RouteAdapterOptions;

export interface TailSamplingContext {
  status?: number;
  durationMs: number;
  path: string;
  method: string;
  context: Record<string, unknown>;
  shouldKeep: boolean;
}

export interface MiddlewareLoggerOptions extends RouteAdapterOptions {
  onFinish?: (ctx: {
    logger: RequestLogger;
    method: string;
    path: string;
    status?: number;
    durationMs: number;
  }) => Awaitable<void>;
  method: string;
  path: string;
  requestId?: string;
}

export interface MiddlewareLoggerResult {
  logger: RequestLogger;
  finish: (opts?: {
    status?: number;
    error?: Error;
    overrides?: Record<string, unknown>;
  }) => Promise<RequestLogSnapshot | null>;
  finishResponse: (
    response: Response,
    opts?: { status?: number; overrides?: Record<string, unknown> },
  ) => Promise<Response>;
  skipped: boolean;
}

const noopResult: MiddlewareLoggerResult = {
  logger: createNoopRequestLogger(),
  finish: () => Promise.resolve(null),
  finishResponse: (response) => Promise.resolve(response),
  skipped: true,
};

export function mergeRequestLoggerOptions(
  base: RequestLoggerOptions | undefined,
  waitUntil?: (promise: Promise<unknown>) => void,
): RequestLoggerOptions | undefined {
  if (!waitUntil) return base;

  const userOnEmit = base?.onEmit;
  return {
    ...base,
    onEmit: (snapshot) => {
      const drain = userOnEmit
        ? Promise.resolve(userOnEmit(snapshot))
        : Promise.resolve();
      extendDeferredDrain(drain, waitUntil);
    },
  };
}

async function performFinish(
  logger: RequestLogger,
  options: MiddlewareLoggerOptions,
  startedAt: number,
  opts?: {
    status?: number;
    error?: Error;
    overrides?: Record<string, unknown>;
  },
): Promise<RequestLogSnapshot | null> {
  const { status, error, overrides } = opts ?? {};

  if (error) {
    logger.error(error);
    logger.set({
      'http.response.status_code': status ?? 500,
      error_message: error.message,
    });
  } else if (status !== undefined) {
    logger.set({ 'http.response.status_code': status });
  }

  const durationMs = Date.now() - startedAt;
  logger.set({ duration_ms: durationMs });

  const tailCtx: TailSamplingContext = {
    status:
      status ??
      (logger.getContext()['http.response.status_code'] as number | undefined),
    durationMs,
    path: options.path,
    method: options.method,
    context: logger.getContext(),
    shouldKeep: false,
  };

  if (options.keep) {
    await options.keep(tailCtx);
  }

  if (options.onFinish) {
    try {
      await options.onFinish({
        logger,
        method: options.method,
        path: options.path,
        status: tailCtx.status,
        durationMs,
      });
    } catch (err) {
      console.error('[autotel-adapters] onFinish failed:', err);
    }
  }

  const mergedOverrides = {
    ...(overrides ?? {}),
    ...(tailCtx.shouldKeep ? { 'autotel.sampling.tail.keep': true } : {}),
  };

  return logger.emitNow(
    Object.keys(mergedOverrides).length > 0 ? mergedOverrides : undefined,
  );
}

/**
 * Create a request logger handle for use inside an active autotel trace span.
 * Call `finish()` or `finishResponse()` when the request completes.
 */
export function createMiddlewareLogger(
  logger: RequestLogger,
  options: MiddlewareLoggerOptions,
): MiddlewareLoggerResult {
  if (!shouldInstrumentPath(options.path, options)) {
    return noopResult;
  }

  const routeService = getServiceForPath(options.path, options.routes);
  if (routeService) {
    logger.set({ service: routeService });
  }

  if (options.requestId) {
    logger.set({ 'http.request.id': options.requestId });
  }

  const startedAt = Date.now();

  return {
    logger,
    skipped: false,
    finish: (opts) => performFinish(logger, options, startedAt, opts),
    finishResponse: async (response, opts) => {
      const status = opts?.status ?? response.status;
      if (!shouldDeferEmitForResponse(response)) {
        await performFinish(logger, options, startedAt, {
          status,
          overrides: opts?.overrides,
        });
        return response;
      }

      return bindStreamingResponseLifecycle(response, async (meta) => {
        await performFinish(logger, options, startedAt, {
          status: meta.status ?? status,
          error: meta.error,
          overrides: opts?.overrides,
        });
      });
    },
  };
}

export type { ForkLifecycle };
