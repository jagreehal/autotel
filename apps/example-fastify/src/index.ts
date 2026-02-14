/**
 * Fastify + autotel example
 *
 * Uses autoInstrumentations: ['http', 'fastify'] for HTTP/Fastify tracing.
 * Run: pnpm start
 */

import 'dotenv/config';
import Fastify from 'fastify';
import { trace, type TraceContext } from 'autotel';

const app = Fastify({ logger: true });

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

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

app.get<{ Params: { userId: string } }>('/users/:userId', async (request, reply) => {
  const { userId } = request.params;
  try {
    const user = await fetchUser(userId);
    return user;
  } catch {
    reply.code(500);
    return { error: 'Failed to fetch user' };
  }
});

app.get<{ Params: { userId: string } }>('/users/:userId/orders', async (request, reply) => {
  const { userId } = request.params;
  try {
    const orders = await fetchOrders(userId);
    return orders;
  } catch {
    reply.code(500);
    return { error: 'Failed to fetch orders' };
  }
});

app.get('/error', async () => {
  throw new Error('This is a test error');
});

const PORT = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`  - http://localhost:${PORT}/health`);
  console.log(`  - http://localhost:${PORT}/users/user-123`);
  console.log(`  - http://localhost:${PORT}/users/user-123/orders`);
  console.log(`  - http://localhost:${PORT}/error`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
