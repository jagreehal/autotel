import { createUseLogger } from './core';

export const useLogger = createUseLogger<{
  pathname?: string;
  method?: string;
}>({
  adapterName: 'tanstack',
  enrich: (ctx) => ({
    'http.request.method': ctx.method,
    'http.route': ctx.pathname,
  }),
});
