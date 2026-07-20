import {
  createDrainPipeline,
  createStructuredError,
  parseError,
  type RequestLogger,
} from 'autotel';
import { getHeader, type FrameworkHandlerOptions } from './core';
import { createLoggerStorage } from './toolkit/storage';
import {
  applyLoggerEnrichment,
  defineFrameworkIntegration,
  runWithIntegratedHandle,
} from './toolkit/integration';

export interface ElysiaContextLike {
  request: Request;
  path: string;
}

export interface ElysiaWithAutotelOptions extends FrameworkHandlerOptions {
  enrichRequest?: (
    ctx: ElysiaContextLike,
  ) => Record<string, unknown> | undefined;
}

const { storage: elysiaLoggerStorage, useLogger: storageUseLogger } =
  createLoggerStorage(
    'request context. Wrap handlers with withAutotelHandler() first.',
  );

function enrichFromContext(
  ctx?: ElysiaContextLike,
): Record<string, unknown> | undefined {
  if (!ctx) return undefined;

  const requestId = getHeader(ctx.request.headers, 'x-request-id');

  return {
    'http.request.method': ctx.request.method,
    'url.full': ctx.request.url,
    'http.route': ctx.path,
    ...(requestId ? { 'http.request.id': requestId } : {}),
  };
}

const integration = defineFrameworkIntegration<ElysiaContextLike>({
  name: 'elysia',
  storage: elysiaLoggerStorage,
  extractRequest: (ctx) => ({
    method: ctx.request.method,
    path: ctx.path,
    headers: ctx.request.headers,
    requestId: getHeader(ctx.request.headers, 'x-request-id'),
  }),
  attachLogger: () => {},
});

export function useLogger(): RequestLogger {
  return storageUseLogger();
}

export function withAutotelHandler<T>(
  handler: (ctx: ElysiaContextLike) => T | Promise<T>,
  options: ElysiaWithAutotelOptions = {},
) {
  return (ctx: ElysiaContextLike) =>
    integration.runTraced(ctx, options, async (handle) => {
      if (handle.skipped) {
        return handle.runWith(() => handler(ctx));
      }

      applyLoggerEnrichment(
        handle.logger,
        enrichFromContext(ctx),
        options.enrichRequest?.(ctx),
      );

      return runWithIntegratedHandle(handle, options, () => handler(ctx));
    });
}

/** @deprecated Use {@link withAutotelHandler}. */
export const autotel = withAutotelHandler;

export { parseError, createDrainPipeline, createStructuredError };
