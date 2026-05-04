import type { RouteServiceConfig } from './types';

export type Awaitable<T> = T | Promise<T>;

export function matchesRoutePattern(path: string, pattern: string): boolean {
  const regexPattern = pattern
    .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll('**', '{{GLOBSTAR}}')
    .replaceAll('*', '[^/]*')
    .replaceAll('{{GLOBSTAR}}', '.*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${regexPattern}$`).test(path);
}

export interface RouteFilterOptions {
  include?: string[];
  exclude?: string[];
}

export function shouldInstrumentPath(
  path: string,
  options: RouteFilterOptions = {},
): boolean {
  const { include, exclude } = options;

  if (exclude && exclude.some((pattern) => matchesRoutePattern(path, pattern))) {
    return false;
  }

  if (!include || include.length === 0) {
    return true;
  }

  return include.some((pattern) => matchesRoutePattern(path, pattern));
}

export function getServiceForPath(
  path: string,
  routes?: Record<string, RouteServiceConfig>,
): string | undefined {
  if (!routes) return undefined;

  for (const [pattern, config] of Object.entries(routes)) {
    if (matchesRoutePattern(path, pattern)) {
      return config.service;
    }
  }

  return undefined;
}

export interface MiddlewareFinishContext<TEvent, TRequest = unknown> {
  event: TEvent;
  request: TRequest;
  status?: number;
}

export interface MiddlewarePipelineOptions<TEvent, TRequest = unknown> {
  enrichers?: Array<
    (ctx: MiddlewareFinishContext<TEvent, TRequest>) => Awaitable<void>
  >;
  drains?: Array<
    (ctx: MiddlewareFinishContext<TEvent, TRequest>) => Awaitable<void>
  >;
  logger?: Pick<Console, 'error'>;
}

export async function runMiddlewareFinishPipeline<TEvent, TRequest = unknown>(
  ctx: MiddlewareFinishContext<TEvent, TRequest>,
  options: MiddlewarePipelineOptions<TEvent, TRequest> = {},
): Promise<void> {
  const logger = options.logger ?? console;

  for (const enrich of options.enrichers ?? []) {
    try {
      await enrich(ctx);
    } catch (err) {
      logger.error('[autotel-edge/middleware] enricher failed:', err);
    }
  }

  const drains = options.drains ?? [];
  if (drains.length === 0) return;

  await Promise.allSettled(
    drains.map(async (drain) => {
      try {
        await drain(ctx);
      } catch (err) {
        logger.error('[autotel-edge/middleware] drain failed:', err);
      }
    }),
  );
}
