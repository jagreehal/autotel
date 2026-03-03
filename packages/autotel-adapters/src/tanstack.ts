import { createUseLogger, createAdapterToolkit } from './core';

export const useLogger = createUseLogger<{
  pathname?: string;
  method?: string;
}>({
  adapterName: 'tanstack',
  enrich: (ctx) => ({
    ...(ctx.method ? { 'http.request.method': ctx.method } : {}),
    ...(ctx.pathname ? { 'http.route': ctx.pathname } : {}),
  }),
});

export const tanstackToolkit = createAdapterToolkit<{
  pathname?: string;
  method?: string;
}>({
  adapterName: 'tanstack',
  enrich: (ctx) => ({
    ...(ctx.method ? { 'http.request.method': ctx.method } : {}),
    ...(ctx.pathname ? { 'http.route': ctx.pathname } : {}),
  }),
});
