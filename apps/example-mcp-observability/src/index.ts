/**
 * MCP Observability Example - AI-Assisted Trace Analysis
 *
 * This example demonstrates:
 * - HTTP server instrumented with autotel
 * - Various endpoint patterns (fast, slow, errors, nested traces)
 * - Integration with Jaeger for trace collection
 * - OpenTelemetry MCP server for AI-assisted trace querying
 *
 * Setup:
 * 1. Start Jaeger: pnpm docker:up
 * 2. Start app: pnpm start
 * 3. Configure MCP server (see README.md)
 * 4. Ask Claude to analyze your traces!
 *
 * Try these queries with Claude:
 * - "Show me all traces with errors from the last 10 minutes"
 * - "What are the slowest endpoints?"
 * - "Find traces where database queries took longer than 100ms"
 */

import 'dotenv/config';
import express from 'express';
import { init, trace, span, type TraceContext } from 'autotel';

// Initialize autotel to export to local Jaeger
init({
  service: 'mcp-observability-demo',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  integrations: ['express', 'http'],
});

const app = express();
app.use(express.json());

// ============================================================================
// Simulated Database Operations
// ============================================================================

const queryUsers = trace((ctx: TraceContext) => async (filters: Record<string, unknown>) => {
  ctx.setAttribute('db.system', 'postgresql');
  ctx.setAttribute('db.operation', 'SELECT');
  ctx.setAttribute('db.table', 'users');
  ctx.setAttribute('db.filters', JSON.stringify(filters));

  // Simulate varying query times
  const queryTime = Math.random() * 150;
  await new Promise(resolve => setTimeout(resolve, queryTime));

  ctx.setAttribute('db.query_time_ms', queryTime);
  ctx.setAttribute('db.rows_returned', 5);

  return [
    { id: '1', name: 'Alice', role: 'admin' },
    { id: '2', name: 'Bob', role: 'user' },
    { id: '3', name: 'Charlie', role: 'user' },
  ];
});

const queryOrders = trace((ctx: TraceContext) => async (userId: string) => {
  ctx.setAttribute('db.system', 'postgresql');
  ctx.setAttribute('db.operation', 'SELECT');
  ctx.setAttribute('db.table', 'orders');
  ctx.setAttribute('db.user_id', userId);

  // Simulate slow query occasionally
  const isSlow = Math.random() > 0.7;
  const queryTime = isSlow ? 200 + Math.random() * 300 : 30 + Math.random() * 70;

  await new Promise(resolve => setTimeout(resolve, queryTime));

  ctx.setAttribute('db.query_time_ms', queryTime);
  ctx.setAttribute('db.slow_query', isSlow);
  ctx.setAttribute('db.rows_returned', 3);

  return [
    { id: 'order-1', userId, amount: 99.99, status: 'completed' },
    { id: 'order-2', userId, amount: 149.99, status: 'pending' },
  ];
});

// ============================================================================
// Simulated External API Calls
// ============================================================================

const callPaymentGateway = trace((ctx: TraceContext) => async (amount: number) => {
  ctx.setAttribute('payment.gateway', 'stripe');
  ctx.setAttribute('payment.amount', amount);
  ctx.setAttribute('payment.currency', 'USD');

  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

  // Occasionally fail
  const shouldFail = Math.random() > 0.9;
  if (shouldFail) {
    ctx.setAttribute('payment.status', 'failed');
    ctx.setAttribute('payment.error', 'insufficient_funds');
    throw new Error('Payment failed: insufficient funds');
  }

  ctx.setAttribute('payment.status', 'success');
  ctx.setAttribute('payment.transaction_id', `txn_${Date.now()}`);

  return { success: true, transactionId: `txn_${Date.now()}` };
});

const sendNotification = trace((ctx: TraceContext) => async (userId: string, message: string) => {
  ctx.setAttribute('notification.channel', 'email');
  ctx.setAttribute('notification.user_id', userId);
  ctx.setAttribute('notification.message_length', message.length);

  await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

  ctx.setAttribute('notification.sent', true);
  return { sent: true };
});

// ============================================================================
// Business Logic Functions
// ============================================================================

const processOrder = trace((ctx: TraceContext) => async (userId: string, items: unknown[], total: number) => {
  ctx.setAttribute('order.user_id', userId);
  ctx.setAttribute('order.item_count', items.length);
  ctx.setAttribute('order.total', total);

  // Step 1: Validate user
  await span({ name: 'validate-user' }, async (validateCtx) => {
    validateCtx.setAttribute('validation.type', 'user');
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  // Step 2: Process payment
  await span({ name: 'process-payment' }, async () => {
    await callPaymentGateway(total);
  });

  // Step 3: Create order record
  await span({ name: 'create-order-record' }, async (recordCtx) => {
    recordCtx.setAttribute('db.system', 'postgresql');
    recordCtx.setAttribute('db.operation', 'INSERT');
    recordCtx.setAttribute('db.table', 'orders');
    await new Promise(resolve => setTimeout(resolve, 40));
  });

  // Step 4: Send confirmation
  await sendNotification(userId, 'Your order has been confirmed!');

  ctx.setAttribute('order.status', 'completed');
  return { orderId: `order-${Date.now()}`, status: 'completed' };
});

// ============================================================================
// HTTP Routes
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'mcp-observability-demo'
  });
});

// Fast endpoint - typical response time < 100ms
app.get('/api/users', async (req, res) => {
  try {
    const filters = req.query;
    const users = await queryUsers(filters);
    res.json({ users, count: users.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Variable speed endpoint - sometimes slow
app.get('/api/users/:userId/orders', async (req, res) => {
  try {
    const { userId } = req.params;
    const orders = await queryOrders(userId);
    res.json({ orders, count: orders.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Complex nested trace with multiple spans
app.post('/api/orders', async (req, res) => {
  try {
    const { userId, items, total } = req.body;

    if (!userId || !items || !total) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await processOrder(userId, items, total);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to process order',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Intentional error endpoint
app.get('/api/error', async (req, res) => {
  throw new Error('This is a test error for MCP demonstration');
});

// Slow endpoint - always takes > 500ms
app.get('/api/events/report', async (req, res) => {
  await span({ name: 'generate-report' }, async (ctx) => {
    ctx.setAttribute('report.type', 'monthly');
    ctx.setAttribute('report.expensive', true);

    // Simulate expensive computation
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

    res.json({
      report: 'Monthly sales report',
      generatedAt: new Date().toISOString(),
      processingTimeMs: 500 + Math.random() * 500
    });
  });
});

// Random behavior endpoint - sometimes succeeds, sometimes fails
app.get('/api/flaky', async (req, res) => {
  await span({ name: 'flaky-operation' }, async (ctx) => {
    const shouldFail = Math.random() > 0.5;
    ctx.setAttribute('operation.will_fail', shouldFail);

    await new Promise(resolve => setTimeout(resolve, 100));

    if (shouldFail) {
      throw new Error('Random failure occurred');
    }

    res.json({ status: 'success', message: 'Operation completed' });
  });
});

// ============================================================================
// Server Startup
// ============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 MCP Observability Demo Server`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`📊 Server running at: http://localhost:${PORT}`);
  console.log(`📈 Jaeger UI: http://localhost:16686\n`);

  console.log(`🔧 Try these endpoints:\n`);
  console.log(`   GET  /health                    - Health check (fast)`);
  console.log(`   GET  /api/users                 - List users (fast)`);
  console.log(`   GET  /api/users/:id/orders      - User orders (variable speed)`);
  console.log(`   POST /api/orders                - Create order (complex trace)`);
  console.log(`   GET  /api/events/report      - Generate report (slow)`);
  console.log(`   GET  /api/error                 - Intentional error`);
  console.log(`   GET  /api/flaky                 - Random success/failure\n`);

  console.log(`🤖 AI-Assisted Observability:\n`);
  console.log(`   1. Generate some traffic to create traces`);
  console.log(`   2. Configure OpenTelemetry MCP server (see README)`);
  console.log(`   3. Ask Claude questions like:\n`);
  console.log(`      • "Show me traces with errors from the last 10 minutes"`);
  console.log(`      • "What are the slowest database queries?"`);
  console.log(`      • "Find failed payment transactions"`);
  console.log(`      • "Which endpoints have the highest error rate?"\n`);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
