import type { Context } from 'hono';
import {
  createDrainPipeline,
  createStructuredError,
  parseError,
  type RequestLogger,
} from 'autotel';
import type { FrameworkHandlerOptions } from './core';
import { createUseLogger } from './core';
import { createLoggerStorage } from './toolkit/storage';
import {
  applyLoggerEnrichment,
  defineFrameworkIntegration,
} from './toolkit/integration';

export interface HonoWithAutotelOptions extends FrameworkHandlerOptions {
  enrichRequest?: (c: Context) => Record<string, unknown> | undefined;
}

const { storage: honoLoggerStorage, useLogger: storageUseLogger } =
  createLoggerStorage(
    'middleware context. Register autotelMiddleware() before your routes.',
  );

const baseUseLogger = createUseLogger<Context>({
  adapterName: 'hono',
  enrich: enrichFromContext,
});

function enrichFromContext(c: Context): Record<string, unknown> {
  return {
    'http.request.method': c.req.method,
    'url.full': c.req.url,
    'http.route': c.req.path,
  };
}

const integration = defineFrameworkIntegration<Context>({
  name: 'hono',
  storage: honoLoggerStorage,
  extractRequest: (c) => ({
    method: c.req.method,
    path: c.req.path,
    headers: c.req.raw.headers,
    requestId: c.req.header('x-request-id') ?? undefined,
  }),
  attachLogger: (c, logger) => {
    c.set('autotelLogger', logger);
  },
});

/** Request logger inside autotelMiddleware / traced handlers. */
export function useLogger(c?: Context): RequestLogger {
  if (honoLoggerStorage.getStore()) {
    return storageUseLogger();
  }
  return baseUseLogger(c);
}

export function autotelMiddleware(options: HonoWithAutotelOptions = {}) {
  return async (c: Context, next: () => Promise<void>) => {
    return integration.runTraced(c, options, async (handle) => {
      if (handle.skipped) {
        await handle.runWith(() => next());
        return;
      }

      applyLoggerEnrichment(
        handle.logger,
        enrichFromContext(c),
        options.enrichRequest?.(c),
      );

      try {
        await handle.runWith(() => next());
        if (options.autoEmit !== false) {
          await handle.finish({ status: c.res.status });
        }
      } catch (error) {
        if (options.autoEmit !== false) {
          await handle.finish({
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
        throw error;
      }
    });
  };
}

/** Alias for {@link useLogger} inside autotelMiddleware. */
export const useLoggerFromContext = useLogger;

export { parseError, createDrainPipeline, createStructuredError };
