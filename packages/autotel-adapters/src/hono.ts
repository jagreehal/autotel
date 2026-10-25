import type { Context } from 'hono';
import type { RouterRoute } from 'hono/types';
import { matchedRoutes } from 'hono/route';
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
    'url.path': c.req.path,
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

      /* The route template, read after routing. Hono gives middleware no way
         to tell an endpoint from middleware: any method can register either.
         `c.req.routeIndex` is the last handler that ran. A later match with a
         concrete template is the endpoint a middleware answered for (an auth
         401 in front of `/admin/users/:id`); a later wildcard is a fallback
         that never ran (`get('*')` after `/users/:id`). Otherwise the handler
         that ran names the route, and under `use('*')` alone it is `/*`. */
      const matchedRoute = () => {
        const routes = routesOf(c);
        const ran = c.req.routeIndex;
        const endpoint = routes
          ?.slice(ran + 1)
          .findLast((route) => !route.path.endsWith('*'));
        const path = (endpoint ?? routes?.[ran] ?? routes?.at(-1))?.path;
        return !path || path === '*' ? '/*' : path;
      };

      try {
        await handle.runWith(() => next());
        handle.setRoute(matchedRoute());
        /* A thrown error never reaches the catch below: Hono's compose
           catches it, stores it on `c.error` and answers through onError. It
           is passed on only for a 5xx, since an HTTPException answered as a
           4xx is the client's error and leaves the span status unset. */
        const error = c.res.status >= 500 ? c.error : undefined;
        if (options.autoEmit === false) {
          handle.markOutcome({ status: c.res.status, error });
        } else {
          /* Hono finalizes `c.res` after middleware returns. Assign the
             observed response here so stream completion, cancellation, and
             failure drive the request snapshot without locking the body. */
          c.res = await handle.finishResponse(c.res, { error });
        }
      } catch (error) {
        handle.setRoute(matchedRoute());
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

let warnedOtherHono = false;

/**
 * The routes the request matched. `hono/route` reads them through a symbol
 * private to the copy of Hono this module loaded, so when the app runs another
 * copy (a bundled app beside an externalised adapter) it finds nothing. The
 * request's own getter is the app's copy answering, so it is the fallback.
 * Naming a span is best effort: a lookup that fails names it `/*` and never
 * fails the request.
 */
function routesOf(c: Context): RouterRoute[] | undefined {
  try {
    return matchedRoutes(c);
  } catch {
    if (!warnedOtherHono) {
      warnedOtherHono = true;
      console.warn(
        '[autotel-adapters/hono] Could not read the matched route through hono/route, ' +
          'most likely because the app and autotel-adapters loaded different copies of Hono. ' +
          'Bundle autotel-adapters with the app, or externalise hono too.',
      );
    }
  }
  try {
    const routes = (c.req as { matchedRoutes?: unknown }).matchedRoutes;
    return Array.isArray(routes) ? (routes as RouterRoute[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Alias for {@link useLogger} inside autotelMiddleware. */
export const useLoggerFromContext = useLogger;

export { parseError, createDrainPipeline, createStructuredError };
