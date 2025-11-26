/**
 * HTTP Server example with autotel
 *
 * This example shows:
 * - HTTP server with Express
 * - Automatic HTTP/Express instrumentation via ESM loader hook
 * - Manual tracing in routes
 * - Error tracking
 *
 * Run: pnpm start
 *
 * Note: Instrumentation is initialized in instrumentation.ts via --import flag
 */

import 'dotenv/config';
import express from 'express';
import { trace, type TraceContext } from 'autotel';

const app = express();

// Example: Database query simulation
const fetchUser = trace((ctx: TraceContext) => async (userId: string) => {
  ctx.setAttribute('db.query', 'SELECT * FROM users WHERE id = ?');
  ctx.setAttribute('db.userId', userId);
  
  // Simulate database query
  await new Promise(resolve => setTimeout(resolve, 50));
  
  return { id: userId, name: `User ${userId}`, email: `user${userId}@example.com` };
});

const fetchOrders = trace((ctx: TraceContext) => async (userId: string) => {
  ctx.setAttribute('db.query', 'SELECT * FROM orders WHERE userId = ?');
  ctx.setAttribute('db.userId', userId);
  
  await new Promise(resolve => setTimeout(resolve, 30));
  
  return [
    { id: 'order-1', userId, amount: 99.99 },
    { id: 'order-2', userId, amount: 149.99 },
  ];
});

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const user = await fetchUser(userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.get('/users/:userId/orders', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const orders = await fetchOrders(userId);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/error', async (req, res) => {
  // Intentionally throw an error to demonstrate error tracking
  throw new Error('This is a test error');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Try these endpoints:`);
  console.log(`   - http://localhost:${PORT}/health`);
  console.log(`   - http://localhost:${PORT}/users/user-123`);
  console.log(`   - http://localhost:${PORT}/users/user-123/orders`);
  console.log(`   - http://localhost:${PORT}/error`);
  console.log(`\n📊 Check Grafana for traces!`);
});

