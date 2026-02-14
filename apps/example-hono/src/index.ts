/**
 * Hono + autotel-hono example
 *
 * Uses autotel-hono's otel() middleware for HTTP tracing and metrics.
 * Run: pnpm start
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { otel } from 'autotel-hono';
import { trace, type TraceContext } from 'autotel';

const app = new Hono();

app.use(
  '*',
  otel({
    serviceName: 'example-hono-service',
    captureRequestHeaders: ['user-agent'],
    captureResponseHeaders: ['content-type'],
  }),
);

const fetchUser = trace((ctx: TraceContext) => async (userId: string) => {
  ctx.setAttribute('db.query', 'SELECT * FROM users WHERE id = ?');
  ctx.setAttribute('db.userId', userId);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { id: userId, name: `User ${userId}`, email: `user${userId}@example.com` };
});

const fetchOrders = trace((ctx: TraceContext) => async (userId: string) => {
  ctx.setAttribute('db.query', 'SELECT * FROM orders WHERE userId = ?');
  ctx.setAttribute('db.userId', userId);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return [
    { id: 'order-1', userId, amount: 99.99 },
    { id: 'order-2', userId, amount: 149.99 },
  ];
});

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/users/:userId', async (c) => {
  const userId = c.req.param('userId');
  try {
    const user = await fetchUser(userId);
    return c.json(user);
  } catch {
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

app.get('/users/:userId/orders', async (c) => {
  const userId = c.req.param('userId');
  try {
    const orders = await fetchOrders(userId);
    return c.json(orders);
  } catch {
    return c.json({ error: 'Failed to fetch orders' }, 500);
  }
});

app.get('/error', () => {
  throw new Error('This is a test error');
});

const PORT = Number(process.env.PORT) || 3000;

serve(app, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
  console.log(`  - http://localhost:${info.port}/health`);
  console.log(`  - http://localhost:${info.port}/users/user-123`);
  console.log(`  - http://localhost:${info.port}/users/user-123/orders`);
  console.log(`  - http://localhost:${info.port}/error`);
});
