import {
  createDrainPipeline,
  parseError,
  createStructuredError,
  type RequestLogger,
  type RequestLoggerOptions,
} from 'autotel';
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
    | { get(name: string): string | null }
    | Record<string, string | undefined>;
}

export interface NextWithAutotelOptions extends Omit<FrameworkHandlerOptions, 'spanName'> {
  spanName?: string | ((request?: NextRequestLike) => string);
  enrichRequest?: (
    request?: NextRequestLike,
  ) => Record<string, unknown> | undefined;
}

const { storage: nextLoggerStorage, useLogger: storageUseLogger } =
  createLoggerStorage('request context. Wrap handlers with withAutotel() first.');

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

function resolveSpanName(
  request: NextRequestLike | undefined,
  options?: NextWithAutotelOptions,
): string {
  if (typeof options?.spanName === 'function') {
    return options.spanName(request);
  }
  return options?.spanName ?? 'next.request';
}

export function withAutotel<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => TReturn | Promise<TReturn>,
  options?: NextWithAutotelOptions,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const request = args[0] as NextRequestLike | undefined;

    return integration.runTraced(
      request,
      buildTracedOptions(options, resolveSpanName(request, options)),
      async (handle) =>
        runWithIntegratedHandle(handle, options, async () => {
          applyLoggerEnrichment(
            handle.logger,
            enrichFromRequest(request),
            options?.enrichRequest?.(request),
          );
          return handler(...args);
        }),
    );
  };
}

export { parseError, createDrainPipeline, createStructuredError };
