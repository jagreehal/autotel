import { AsyncLocalStorage } from 'node:async_hooks';
import {
  getRequestLogger,
  trace,
  type RequestLogger,
  type RequestLoggerOptions,
} from 'autotel';
import { createAdapterToolkit, createUseLogger } from './core';

export interface NitroEventLike {
  method?: string;
  path?: string;
  context?: Record<string, unknown>;
}

export interface NitroWithAutotelOptions {
  spanName?: string | ((event: NitroEventLike) => string);
  requestLoggerOptions?: RequestLoggerOptions;
  enrich?: (event: NitroEventLike) => Record<string, unknown> | undefined;
}

function enrichFromEvent(
  event?: NitroEventLike,
): Record<string, unknown> | undefined {
  if (!event) return undefined;

  return {
    ...(event.method ? { 'http.request.method': event.method } : {}),
    ...(event.path ? { 'http.route': event.path } : {}),
    ...(typeof event.context?.requestId === 'string'
      ? { 'http.request.id': event.context.requestId }
      : {}),
  };
}

const baseUseLogger = createUseLogger<NitroEventLike>({
  adapterName: 'nitro',
  enrich: enrichFromEvent,
});
const nitroLoggerStorage = new AsyncLocalStorage<RequestLogger>();

export function useLogger(
  event?: NitroEventLike,
  serviceOrOptions?: string | RequestLoggerOptions,
): RequestLogger {
  const stored = nitroLoggerStorage.getStore();
  const logger = stored ??
    (
    typeof serviceOrOptions === 'string'
      ? baseUseLogger(event)
      : baseUseLogger(event, serviceOrOptions)
    );

  if (typeof serviceOrOptions === 'string' && serviceOrOptions.length > 0) {
    logger.set({ service: serviceOrOptions });
  }

  return logger;
}

export function withAutotelEventHandler<TEvent extends NitroEventLike, TReturn>(
  handler: (event: TEvent) => TReturn | Promise<TReturn>,
  options?: NitroWithAutotelOptions,
): (event: TEvent) => Promise<TReturn> {
  return async (event: TEvent): Promise<TReturn> => {
    const spanName =
      typeof options?.spanName === 'function'
        ? options.spanName(event)
        : (options?.spanName ?? `nitro.${event.method ?? 'request'}`);

    const wrapped = trace({ name: spanName }, (ctx) => async (innerEvent: TEvent) => {
      const log = getRequestLogger(ctx, options?.requestLoggerOptions);
      const auto = enrichFromEvent(innerEvent);
      if (auto && Object.keys(auto).length > 0) {
        log.set(auto);
      }
      const custom = options?.enrich?.(innerEvent);
      if (custom && Object.keys(custom).length > 0) {
        log.set(custom);
      }
      return await nitroLoggerStorage.run(log, async () => handler(innerEvent));
    });

    return await wrapped(event);
  };
}

export function createNitroAdapter(options?: NitroWithAutotelOptions) {
  const toolkit = createAdapterToolkit<NitroEventLike>({
    adapterName: 'nitro',
    enrich: (event) => ({
      ...enrichFromEvent(event),
      ...(options?.enrich?.(event) ?? {}),
    }),
  });

  return {
    withAutotelEventHandler: <TEvent extends NitroEventLike, TReturn>(
      handler: (event: TEvent) => TReturn | Promise<TReturn>,
    ) => withAutotelEventHandler(handler, options),
    useLogger,
    parseError: toolkit.parseError,
    createStructuredError: toolkit.createStructuredError,
    createDrainPipeline: toolkit.createDrainPipeline,
  };
}

export const nitroToolkit = createAdapterToolkit<NitroEventLike>({
  adapterName: 'nitro',
  enrich: enrichFromEvent,
});
