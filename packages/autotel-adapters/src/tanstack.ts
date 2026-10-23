import { createUseLogger } from './core';

export const useLogger = createUseLogger<{
  pathname?: string;
  method?: string;
  /** Matched route template (TanStack's `routeId`, e.g. `/posts/$postId`). */
  route?: string;
}>({
  adapterName: 'tanstack',
  enrich: (ctx) => ({
    'http.request.method': ctx.method,
    'url.path': ctx.pathname,
    'http.route': ctx.route,
  }),
});
