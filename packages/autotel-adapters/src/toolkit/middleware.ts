import type {
  ForkLifecycle,
  RequestLogger,
  RequestLoggerOptions,
  RequestLogSnapshot,
} from 'autotel';
import {
  createNoopRequestLogger,
  recordStructuredError,
  SpanStatusCode,
} from 'autotel';
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

/** How a request ended, as far as the span is concerned. */
export interface RequestOutcome {
  status?: number;
  error?: Error;
}

export interface MiddlewareLoggerResult {
  logger: RequestLogger;
  /**
   * Record the outcome on the span now: the status code, ERROR for a 5xx, and
   * the error as its exception. Separate from emitting the snapshot, so it
   * happens with `autoEmit: false` too, and before a streamed body (whose
   * snapshot waits for the stream) outlives the span.
   */
  markOutcome: (outcome: RequestOutcome) => void;
  finish: (opts?: {
    status?: number;
    error?: Error;
    overrides?: Record<string, unknown>;
  }) => Promise<RequestLogSnapshot | null>;
  finishResponse: (
    response: Response,
    opts?: {
      status?: number;
      /** What the framework caught on the way to this response, if anything. */
      error?: Error;
      overrides?: Record<string, unknown>;
    },
  ) => Promise<Response>;
  skipped: boolean;
}

const noopResult: MiddlewareLoggerResult = {
  logger: createNoopRequestLogger(),
  markOutcome: () => {},
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

/** The request span, for the status a log line cannot set. */
type RequestSpan = Parameters<typeof recordStructuredError>[0];

/**
 * A server span with a 5xx response is an error, whether or not anything was
 * thrown (OpenTelemetry HTTP conventions); a 4xx is the client's and is left
 * unset. Without this, error-based sampling and alerts miss every request
 * that answered 500 without an exception reaching the adapter.
 */
export function markServerError(
  span: RequestSpan | undefined,
  status: number | undefined,
): void {
  if (status !== undefined && status >= 500) {
    span?.setStatus({ code: SpanStatusCode.ERROR });
  }
}

function recordOutcome(
  logger: RequestLogger,
  span: RequestSpan | undefined,
  { status, error }: RequestOutcome,
  emitted: () => boolean,
): void {
  if (error) {
    /* `logger.error()` records the exception, the `log.error` event and the
       error level, but does nothing once the snapshot is out, and a handler
       may emit it before throwing. Then the exception goes straight onto the
       span. One or the other, so it is recorded once. */
    if (span && emitted()) recordStructuredError(span, error);
    else logger.error(error);
    logger.set({
      'http.response.status_code': status ?? 500,
      error_message: error.message,
    });
  } else if (status !== undefined) {
    logger.set({ 'http.response.status_code': status });
    markServerError(span, status);
  }
}

async function performFinish(
  logger: RequestLogger,
  options: MiddlewareLoggerOptions,
  startedAt: number,
  span: RequestSpan | undefined,
  emitted: () => boolean,
  opts?: {
    status?: number;
    error?: Error;
    overrides?: Record<string, unknown>;
  },
): Promise<RequestLogSnapshot | null> {
  const { status, overrides } = opts ?? {};
  recordOutcome(logger, span, opts ?? {}, emitted);

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
    'autotel.sampling.tail.keep': true,
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
  span?: RequestSpan,
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

  // The handler's `useLogger()` is this logger, so its own `emitNow()` lands
  // here too.
  let hasEmitted = false;
  const emitNow = logger.emitNow.bind(logger);
  logger.emitNow = (overrides) => {
    hasEmitted = true;
    return emitNow(overrides);
  };
  const emitted = () => hasEmitted;

  return {
    logger,
    skipped: false,
    markOutcome: (outcome) => recordOutcome(logger, span, outcome, emitted),
    finish: (opts) =>
      performFinish(logger, options, startedAt, span, emitted, opts),
    finishResponse: async (response, opts) => {
      const status = opts?.status ?? response.status;
      if (!shouldDeferEmitForResponse(response)) {
        await performFinish(logger, options, startedAt, span, emitted, {
          status,
          error: opts?.error,
          overrides: opts?.overrides,
        });
        return response;
      }

      // The span ends when the handler returns, long before a streamed body
      // does, so what is already known goes on it now. Only the snapshot
      // waits, and records how the stream itself ended.
      recordOutcome(logger, span, { status, error: opts?.error }, emitted);
      return bindStreamingResponseLifecycle(response, async (meta) => {
        await performFinish(logger, options, startedAt, span, emitted, {
          status: meta.status ?? status,
          error: meta.error,
          overrides: opts?.overrides,
        });
      });
    },
  };
}

export type { ForkLifecycle };
