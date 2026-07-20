import { from, isObservable, Observable, type Subscription } from 'rxjs';
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
  type ExtractedRequest,
} from './toolkit/integration';

export interface NestExecutionContextLike {
  getClass: () => { name: string };
  getHandler: () => { name: string };
  getType: () => string;
  switchToHttp: () => {
    getRequest: () => NestRequestLike;
    getResponse: () => NestResponseLike;
  };
}

export interface NestRequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface NestResponseLike {
  statusCode?: number;
}

export interface NestWithAutotelOptions extends FrameworkHandlerOptions {
  enrichRequest?: (
    request: NestRequestLike,
  ) => Record<string, unknown> | undefined;
}

const { storage: nestLoggerStorage, useLogger: storageUseLogger } =
  createLoggerStorage(
    'request context. Register AutotelInterceptor globally or on controllers.',
  );

function enrichFromRequest(
  request?: NestRequestLike,
): Record<string, unknown> | undefined {
  if (!request) return undefined;

  const url = request.originalUrl ?? request.url;
  const route = request.path ?? url;

  return {
    ...(request.method ? { 'http.request.method': request.method } : {}),
    ...(url ? { 'url.full': url } : {}),
    ...(route ? { 'http.route': route } : {}),
  };
}

const integration = defineFrameworkIntegration<NestExecutionContextLike>({
  name: 'nestjs',
  storage: nestLoggerStorage,
  extractRequest: (executionCtx) => {
    const request = executionCtx.switchToHttp().getRequest();
    const path = request.path ?? request.originalUrl ?? request.url ?? '/';
    return {
      method: request.method ?? 'GET',
      path,
      headers: request.headers,
    } satisfies ExtractedRequest;
  },
  attachLogger: () => {},
  spanName: (executionCtx) => {
    const handler = executionCtx.getHandler().name;
    const controller = executionCtx.getClass().name;
    return `nestjs.${controller}.${handler}`;
  },
});

export function useLogger(): RequestLogger {
  return storageUseLogger();
}

export class AutotelInterceptor {
  constructor(public readonly options: NestWithAutotelOptions = {}) {}

  intercept(
    executionCtx: NestExecutionContextLike,
    next: { handle: () => unknown },
  ): Observable<unknown> {
    // Nest handlers are lazy Observables. Subscribe inside the trace + ALS
    // scope, but proxy values as they arrive so multi-value and streaming
    // handlers retain their normal semantics.
    return new Observable((subscriber) => {
      let sourceSubscription: Subscription | undefined;
      let cancelled = false;
      let cancelRun: (() => void) | undefined;

      const run = integration.runTraced(
        executionCtx,
        this.options,
        async (handle) => {
          if (!handle.skipped) {
            const request = executionCtx.switchToHttp().getRequest();
            applyLoggerEnrichment(
              handle.logger,
              enrichFromRequest(request),
              this.options.enrichRequest?.(request),
            );
          }

          await handle.runWith(
            () =>
              new Promise<void>((resolve, reject) => {
                let settled = false;

                const settle = async (error?: unknown) => {
                  if (settled) return;
                  settled = true;

                  try {
                    if (!handle.skipped && this.options.autoEmit !== false) {
                      if (error !== undefined) {
                        await handle.finish({
                          error:
                            error instanceof Error
                              ? error
                              : new Error(String(error)),
                        });
                      } else {
                        const response = executionCtx
                          .switchToHttp()
                          .getResponse();
                        await handle.finish({ status: response.statusCode });
                      }
                    }
                  } catch (finishError) {
                    reject(finishError);
                    return;
                  }

                  if (error !== undefined) reject(error);
                  else resolve();
                };

                cancelRun = () => {
                  void settle();
                };

                let source: unknown;
                try {
                  source = next.handle();
                } catch (error) {
                  void settle(error);
                  return;
                }

                const observable = isObservable(source)
                  ? source
                  : from(Promise.resolve(source));
                sourceSubscription = observable.subscribe({
                  next: (value) => {
                    if (!cancelled) subscriber.next(value);
                  },
                  error: (error) => {
                    void settle(error);
                  },
                  complete: () => {
                    void settle();
                  },
                });

                if (cancelled) {
                  sourceSubscription.unsubscribe();
                  cancelRun();
                }
              }),
          );
        },
      );

      void run.then(
        () => {
          if (!cancelled) subscriber.complete();
        },
        (error: unknown) => {
          if (!cancelled) subscriber.error(error);
        },
      );

      return () => {
        cancelled = true;
        sourceSubscription?.unsubscribe();
        cancelRun?.();
      };
    });
  }
}

export { parseError, createDrainPipeline, createStructuredError };
