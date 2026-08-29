/**
 * Hono + autotel-hono example
 *
 * Uses autotel-hono's otel() middleware for HTTP tracing and metrics.
 * Run: pnpm start
 */

import { serve } from '@hono/node-server';
import { app } from './app';

const PORT = Number(process.env.PORT) || 3000;

// PORT was read and then dropped, so the env var never moved the listener.
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
  console.log(`  - http://localhost:${info.port}/health`);
  console.log(`  - http://localhost:${info.port}/users/user-123`);
  console.log(`  - http://localhost:${info.port}/users/user-123/orders`);
  console.log(`  - http://localhost:${info.port}/error`);
});
