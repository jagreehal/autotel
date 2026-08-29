/**
 * The routes, without a listener.
 *
 * Kept separate from the server entry so `coverage-check.ts` can drive the
 * same app in-process through `app.request()`, which is what lets the
 * instrumentation coverage check run without a port.
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { otel } from 'autotel-hono';
import { useLogger } from 'autotel-adapters/hono';
import { type TraceContext, withTracing } from 'autotel';

const app = new Hono();

app.use(
  '*',
  otel({
    serviceName: 'example-hono-service',
    captureRequestHeaders: ['user-agent'],
    captureResponseHeaders: ['content-type'],
  }),
);

const fetchUser = withTracing({})(
  (ctx: TraceContext) => async (userId: string) => {
    ctx.setAttribute('db.query', 'SELECT * FROM users WHERE id = ?');
    ctx.setAttribute('db.userId', userId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      id: userId,
      name: `User ${userId}`,
      email: `user${userId}@example.com`,
    };
  },
);

const fetchOrders = withTracing({})(
  (ctx: TraceContext) => async (userId: string) => {
    ctx.setAttribute('db.query', 'SELECT * FROM orders WHERE userId = ?');
    ctx.setAttribute('db.userId', userId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return [
      { id: 'order-1', userId, amount: 99.99 },
      { id: 'order-2', userId, amount: 149.99 },
    ];
  },
);

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

app.get('/users/:userId', async (c) => {
  const log = useLogger(c);
  const userId = c.req.param('userId');
  log.set({ userId, endpoint: '/users/:userId' });
  try {
    const user = await fetchUser(userId);
    log.info('Fetched user', { found: true });
    return c.json(user);
  } catch (error) {
    log.error(error instanceof Error ? error : new Error(String(error)), {
      endpoint: '/users/:userId',
    });
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

app.get('/users/:userId/orders', async (c) => {
  const log = useLogger(c);
  const userId = c.req.param('userId');
  log.set({ userId, endpoint: '/users/:userId/orders' });
  try {
    const orders = await fetchOrders(userId);
    log.info('Fetched orders', { ordersCount: orders.length });
    return c.json(orders);
  } catch (error) {
    log.error(error instanceof Error ? error : new Error(String(error)), {
      endpoint: '/users/:userId/orders',
    });
    return c.json({ error: 'Failed to fetch orders' }, 500);
  }
});

app.get('/error', () => {
  const log = useLogger();
  log.warn('Triggering test error endpoint');
  throw new Error('This is a test error');
});

export { app };
