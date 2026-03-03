import type { Context } from 'hono';
import { createUseLogger, createAdapterToolkit } from './core';

export const useLogger = createUseLogger<Context>({
  adapterName: 'hono',
  enrich: (c) => ({
    'http.request.method': c.req.method,
    'url.full': c.req.url,
    'http.route': c.req.path,
  }),
});

export const honoToolkit = createAdapterToolkit<Context>({
  adapterName: 'hono',
  enrich: (c) => ({
    'http.request.method': c.req.method,
    'url.full': c.req.url,
    'http.route': c.req.path,
  }),
});
