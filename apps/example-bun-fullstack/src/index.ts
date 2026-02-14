/**
 * Bun + autotel simplest value example.
 * One process, autotel init + traced /api/health. Confirms autotel works with Bun.
 *
 * Run: bun run src/index.ts  (or from repo root: pnpm --filter @jagreehal/example-bun-fullstack start)
 */

import { init, getTracer, trace, type TraceContext } from 'autotel';

const PORT = Number(process.env.PORT) || 3000;

init({
  service: 'example-bun-fullstack',
  debug: true,
  endpoint: process.env.OTLP_ENDPOINT,
});

const tracer = getTracer('example-bun-fullstack', '1.0.0');

// Simplest traced value: a function that returns a value under a span
const getHealth = trace((_ctx: TraceContext) => () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

export default {
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/api/health') {
      const value = getHealth();
      return Response.json(value);
    }
    return new Response('Not found', { status: 404 });
  },
};

console.log(`Bun + autotel on http://localhost:${PORT}`);
console.log(`  GET http://localhost:${PORT}/api/health → traced value`);
