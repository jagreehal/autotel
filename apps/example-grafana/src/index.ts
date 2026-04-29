/**
 * Grafana Cloud + Autotel Example
 *
 * Sends traces (Tempo), metrics (Mimir), and logs (Loki) to Grafana Cloud.
 * Uses only autotel and autotel-backends — no direct OpenTelemetry imports.
 *
 * Run: pnpm start
 */

import 'dotenv/config';
import { init, trace, shutdown, Metric, track, type TraceContext } from 'autotel';
import { createBuiltinLogger } from 'autotel/logger';
import { createGrafanaConfig } from 'autotel-backends/grafana';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS;
const serviceName = process.env.OTEL_SERVICE_NAME || 'example-grafana';

if (!endpoint) {
  console.error('❌ OTEL_EXPORTER_OTLP_ENDPOINT is required');
  console.error('   Get it from: Grafana Cloud → your stack → Connections → OpenTelemetry → Configure');
  process.exit(1);
}

const logger = createBuiltinLogger(serviceName, {
  level: 'info',
  pretty: true,
});

init({
  ...createGrafanaConfig({
    endpoint,
    headers: headers || undefined,
    service: serviceName,
    environment: process.env.NODE_ENV || 'development',
    enableLogs: true,
  }),
  logger,
  canonicalLogLines: { enabled: true },
});

logger.info({ endpoint }, 'Autotel initialized for Grafana Cloud (traces, metrics, logs)');

const metrics = new Metric('example-grafana', { logger });

// ============================================================================
// Demo: traced functions with logging and metrics
// ============================================================================

const createUser = trace((ctx: TraceContext) => async (name: string, email: string) => {
  logger.info({ name, email }, 'Creating user');
  ctx.setAttribute('user.name', name);
  ctx.setAttribute('user.email', email);
  await new Promise((r) => setTimeout(r, 80));
  metrics.trackEvent('user.created', { name, email });
  track('user.signup', { userId: `user-${Date.now()}`, name, email, plan: 'free' });
  const userId = `user-${Date.now()}`;
  logger.info({ userId, name, email }, 'User created');
  return { id: userId, name, email };
});

const processPayment = trace((ctx: TraceContext) => async (amount: number, userId: string) => {
  logger.info({ amount, userId }, 'Processing payment');
  ctx.setAttribute('payment.amount', amount);
  ctx.setAttribute('payment.userId', userId);
  await new Promise((r) => setTimeout(r, 120));
  if (Math.random() > 0.75) {
    const err = new Error('Payment processing failed');
    ctx.setStatus({ code: 2, message: 'Payment failed' });
    ctx.recordError(err);
    logger.error({ err, amount, userId }, 'Payment failed');
    throw err;
  }
  metrics.trackEvent('payment.processed', { amount, userId });
  track('payment.completed', { amount, userId, currency: 'USD' });
  const txId = `tx-${Date.now()}`;
  logger.info({ transactionId: txId, amount, userId }, 'Payment processed');
  ctx.setStatus({ code: 1 });
  return { transactionId: txId, amount, userId };
});

const createOrder = trace((ctx: TraceContext) => async (userId: string, items: string[]) => {
  logger.info({ userId, itemCount: items.length }, 'Creating order');
  ctx.setAttribute('order.userId', userId);
  ctx.setAttribute('order.itemCount', items.length);
  const user = await createUser(`User-${userId}`, `user${userId}@example.com`);
  logger.info({ user }, 'User created for order');
  const total = items.length * 10;
  const payment = await processPayment(total, userId);
  metrics.trackEvent('order.created', { userId, itemCount: items.length, total });
  track('order.completed', { orderId: payment.transactionId, userId, itemCount: items.length, total });
  logger.info(
    { orderId: payment.transactionId, userId, items, total },
    'Order created successfully',
  );
  return { orderId: payment.transactionId, userId, items, total };
});

// ============================================================================
// Run demo and shutdown
// ============================================================================

async function main() {
  logger.info('Starting Grafana Cloud example');

  try {
    const user = await createUser('Alice', 'alice@example.com');
    logger.info({ user }, 'User created');

    try {
      const payment = await processPayment(99.99, 'user-123');
      logger.info({ payment }, 'Payment processed');
    } catch (e) {
      logger.error({ err: e }, 'Payment failed (expected sometimes)');
    }

    const order = await createOrder('user-456', ['item1', 'item2', 'item3']);
    logger.info({ order }, 'Order created');

    logger.info('Demo completed; shutting down');
  } catch (err) {
    logger.error({ err }, 'Demo error');
  }

  try {
    await shutdown();
  } catch (shutdownErr) {
    logger.warn(
      { err: shutdownErr },
      'Shutdown had errors. Check OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS.',
    );
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
