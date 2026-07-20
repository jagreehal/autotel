import {
  createDrainPipeline,
  createStructuredError,
  parseError,
  type RequestLogger,
} from 'autotel';
import type { FrameworkHandlerOptions } from './core';
import { createLoggerStorage } from './toolkit/storage';
import {
  applyLoggerEnrichment,
  defineFrameworkIntegration,
  runWithIntegratedHandle,
} from './toolkit/integration';

export interface SvelteKitEventLike {
  request: Request;
  url: URL;
  route?: { id?: string };
  locals?: Record<string, unknown>;
}

export interface SvelteKitHandleInput {
  event: SvelteKitEventLike;
  resolve: (event: SvelteKitEventLike) => Response | Promise<Response>;
}

export interface SvelteKitWithAutotelOptions extends FrameworkHandlerOptions {
  enrichRequest?: (
    event: SvelteKitEventLike,
  ) => Record<string, unknown> | undefined;
}

const { storage: svelteKitLoggerStorage, useLogger: storageUseLogger } =
  createLoggerStorage(
    'request context. Register autotelHandle() in hooks.server.ts first.',
  );

function enrichFromEvent(
  event?: SvelteKitEventLike,
): Record<string, unknown> | undefined {
  if (!event) return undefined;

  return {
    'http.request.method': event.request.method,
    'url.full': event.url.toString(),
    'http.route': event.route?.id ?? event.url.pathname,
    ...(event.request.headers.get('x-request-id')
      ? { 'http.request.id': event.request.headers.get('x-request-id')! }
      : {}),
  };
}

const integration = defineFrameworkIntegration<SvelteKitEventLike>({
  name: 'sveltekit',
  storage: svelteKitLoggerStorage,
  extractRequest: (event) => ({
    method: event.request.method,
    path: event.url.pathname,
    headers: event.request.headers,
    requestId: event.request.headers.get('x-request-id') ?? undefined,
  }),
  attachLogger: (event, logger) => {
    event.locals ??= {};
    event.locals.autotelLogger = logger;
  },
});

export function useLogger(): RequestLogger {
  return storageUseLogger();
}

export function autotelHandle(options: SvelteKitWithAutotelOptions = {}) {
  return async ({ event, resolve }: SvelteKitHandleInput): Promise<Response> =>
    integration.runTraced(event, options, async (handle) => {
      if (handle.skipped) {
        return handle.runWith(() => resolve(event));
      }

      applyLoggerEnrichment(
        handle.logger,
        enrichFromEvent(event),
        options.enrichRequest?.(event),
      );

      return runWithIntegratedHandle(handle, options, () => resolve(event));
    });
}

export { parseError, createDrainPipeline, createStructuredError };
