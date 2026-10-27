import {
  createDrainPipeline,
  parseError,
  createStructuredError,
  getRequestLogger,
  trace,
  type RequestLogger,
  type RequestLoggerOptions,
} from 'autotel';
import { unstable_rethrow as unstableRethrow } from 'next/navigation.js';
import {
  createUseLogger,
  getHeader,
  type FrameworkHandlerOptions,
} from './core';
import { createLoggerStorage } from './toolkit/storage';
import {
  applyLoggerEnrichment,
  defineFrameworkIntegration,
  runWithIntegratedHandle,
  buildTracedOptions,
} from './toolkit/integration';

export interface NextRequestLike {
  method?: string;
  url?: string;
  headers?:
    { get(name: string): string | null } | Record<string, string | undefined>;
}

export interface NextWithAutotelOptions extends Omit<
  FrameworkHandlerOptions,
  'spanName'
> {
  spanName?: string | ((request?: NextRequestLike) => string);
  enrichRequest?: (
    request?: NextRequestLike,
  ) => Record<string, unknown> | undefined;
}

/**
 * Next navigation helpers throw internal values that the framework converts
 * into responses. Delegate classification to Next itself so new signal types
 * and signals wrapped in `cause` stay covered without duplicating its internals.
 */
function findNextControlFlowSignal(cause: unknown): unknown | null {
  try {
    unstableRethrow(cause);
    return null;
  } catch (signal) {
    return signal;
  }
}

function isRealNextError(cause: unknown): boolean {
  return findNextControlFlowSignal(cause) === null;
}

const { storage: nextLoggerStorage, useLogger: storageUseLogger } =
  createLoggerStorage(
    'request context. Wrap handlers with withAutotel() first.',
  );

function enrichFromRequest(
  request?: NextRequestLike,
): Record<string, unknown> | undefined {
  if (!request) return undefined;

  const requestId = getHeader(request.headers, 'x-request-id');

  return {
    'http.request.method': request.method,
    'url.full': request.url,
    'url.path': resolvePath(request),
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
  try {
    return storageUseLogger();
  } catch {
    return baseUseLogger(request, requestLoggerOptions);
  }
}

function resolvePath(request?: NextRequestLike): string {
  if (!request?.url) return '/';
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

const integration = defineFrameworkIntegration<NextRequestLike | undefined>({
  name: 'next',
  storage: nextLoggerStorage,
  extractRequest: (request) => ({
    method: request?.method ?? 'GET',
    path: resolvePath(request),
    headers: request?.headers,
    requestId: getHeader(request?.headers, 'x-request-id'),
  }),
  attachLogger: () => {},
});

// A server action's first argument is its form data or its own argument, so
// only something with a URL and headers is read as the request. FormData has
// a `get()` too, and would otherwise answer the `x-request-id` lookup.
function asRequest(value: unknown): NextRequestLike | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    'headers' in value
    ? (value as NextRequestLike)
    : undefined;
}

function resolveSpanName(
  request: NextRequestLike | undefined,
  options?: NextWithAutotelOptions,
): string | undefined {
  if (typeof options?.spanName === 'function') {
    return options.spanName(request);
  }
  return options?.spanName;
}

/**
 * Trace a route handler. Its first argument is read as the request. For a
 * server action use {@link withAutotelAction}: it has no request.
 */
export function withAutotel<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => TReturn | Promise<TReturn>,
  options?: NextWithAutotelOptions,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const request = asRequest(args[0]);
    const tracedOptions = buildTracedOptions(
      options,
      resolveSpanName(request, options),
    );

    return integration.runTraced(
      request,
      tracedOptions,
      async (handle) =>
        runWithIntegratedHandle(
          handle,
          { autoEmit: tracedOptions.autoEmit, isError: isRealNextError },
          async () => {
            applyLoggerEnrichment(
              handle.logger,
              enrichFromRequest(request),
              options?.enrichRequest?.(request),
            );
            try {
              return await handler(...args);
            } catch (error) {
              const signal = findNextControlFlowSignal(error);
              throw signal ?? error;
            }
          },
        ),
      { isError: isRealNextError },
    );
  };
}

/**
 * Trace a server action: span `action.<name>`, no HTTP attributes (an action
 * has no request of its own), `useLogger()` inside it, and one wide event
 * when it settles. `redirect()` and `notFound()` pass through as non-errors.
 *
 * @example
 * ```ts
 * 'use server';
 * export const save = withAutotelAction('save', async (formData: FormData) => {
 *   useLogger().set({ 'item.id': formData.get('id') });
 * });
 * ```
 */
export function withAutotelAction<TArgs extends unknown[], TReturn>(
  name: string,
  action: (...args: TArgs) => TReturn | Promise<TReturn>,
  options?: { requestLoggerOptions?: RequestLoggerOptions },
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs): Promise<TReturn> =>
    trace.run(
      { name: `action.${name}`, isError: isRealNextError },
      async (ctx) => {
        const log = getRequestLogger(ctx, options?.requestLoggerOptions);
        const startedAt = Date.now();
        try {
          return await nextLoggerStorage.run(log, async () => action(...args));
        } catch (error) {
          const signal = findNextControlFlowSignal(error);
          if (!signal) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            log.error(err, { error_message: err.message });
          }
          throw signal ?? error;
        } finally {
          log.emitNow({ duration_ms: Date.now() - startedAt });
        }
      },
    );
}

export { parseError, createDrainPipeline, createStructuredError };
