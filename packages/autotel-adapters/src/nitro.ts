import {
  createDrainPipeline,
  parseError,
  createStructuredError,
  type RequestLogger,
  type RequestLoggerOptions,
} from 'autotel';
import { createUseLogger, type FrameworkHandlerOptions } from './core';
import { createLoggerStorage } from './toolkit/storage';
import {
  applyLoggerEnrichment,
  defineFrameworkIntegration,
  runWithIntegratedHandle,
  buildTracedOptions,
} from './toolkit/integration';

export interface NitroEventLike {
  method?: string;
  path?: string;
  context?: {
    /** h3 v1 sets `path`, h3 v2 sets `route`. */
    matchedRoute?: { path?: string; route?: string };
    [key: string]: unknown;
  };
}

function matchedRoute(event: NitroEventLike): string | undefined {
  const matched = event.context?.matchedRoute;
  return matched?.route ?? matched?.path;
}

export interface NitroWithAutotelOptions extends Omit<
  FrameworkHandlerOptions,
  'spanName'
> {
  spanName?: string | ((event: NitroEventLike) => string);
  enrichRequest?: (
    event: NitroEventLike,
  ) => Record<string, unknown> | undefined;
}

function enrichFromEvent(
  event?: NitroEventLike,
): Record<string, unknown> | undefined {
  if (!event) return undefined;

  return {
    'http.request.method': event.method,
    'url.path': event.path,
    'http.route': matchedRoute(event),
    ...(typeof event.context?.requestId === 'string'
      ? { 'http.request.id': event.context.requestId }
      : {}),
  };
}

const { storage: nitroLoggerStorage, useLogger: storageUseLogger } =
  createLoggerStorage(
    'request context. Wrap handlers with withAutotelEventHandler() first.',
  );

const baseUseLogger = createUseLogger<NitroEventLike>({
  adapterName: 'nitro',
  enrich: enrichFromEvent,
});

export function useLogger(
  event?: NitroEventLike,
  serviceOrOptions?: string | RequestLoggerOptions,
): RequestLogger {
  try {
    const logger = storageUseLogger();
    if (typeof serviceOrOptions === 'string' && serviceOrOptions.length > 0) {
      logger.set({ service: serviceOrOptions });
    }
    return logger;
  } catch {
    const logger =
      typeof serviceOrOptions === 'string'
        ? baseUseLogger(event)
        : baseUseLogger(event, serviceOrOptions);

    if (typeof serviceOrOptions === 'string' && serviceOrOptions.length > 0) {
      logger.set({ service: serviceOrOptions });
    }

    return logger;
  }
}

const integration = defineFrameworkIntegration<NitroEventLike>({
  name: 'nitro',
  storage: nitroLoggerStorage,
  extractRequest: (event) => ({
    method: event.method ?? 'GET',
    path: event.path ?? '/',
    route: matchedRoute(event),
    requestId:
      typeof event.context?.requestId === 'string'
        ? event.context.requestId
        : undefined,
  }),
  attachLogger: () => {},
});

function resolveSpanName(
  event: NitroEventLike,
  options?: NitroWithAutotelOptions,
): string | undefined {
  if (typeof options?.spanName === 'function') {
    return options.spanName(event);
  }
  return options?.spanName;
}

export function withAutotelEventHandler<TEvent extends NitroEventLike, TReturn>(
  handler: (event: TEvent) => TReturn | Promise<TReturn>,
  options?: NitroWithAutotelOptions,
): (event: TEvent) => Promise<TReturn> {
  return async (event: TEvent): Promise<TReturn> =>
    integration.runTraced(
      event,
      buildTracedOptions(options, resolveSpanName(event, options)),
      async (handle) =>
        runWithIntegratedHandle(handle, options, async () => {
          applyLoggerEnrichment(
            handle.logger,
            enrichFromEvent(event),
            options?.enrichRequest?.(event),
          );
          return handler(event);
        }),
    );
}

export { parseError, createDrainPipeline, createStructuredError };
