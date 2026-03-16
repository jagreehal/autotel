/**
 * otel-tui demo: traces, spans, and correlated Pino logs
 *
 * This generates realistic multi-service traces with nested spans
 * and Pino logs that carry trace_id + span_id for correlation.
 *
 * Usage:
 *   1. Start otel-tui:  otel-tui
 *   2. Run this app:     pnpm start
 *
 * In otel-tui you should see:
 *   - Traces tab: traces with nested spans
 *   - Logs tab: Pino logs correlated to each trace/span
 *   - Select a trace → see its span tree → see logs attached to spans
 */

import { trace, span, shutdown, flush } from 'autotel';
import pino from 'pino';

const logger = pino({
  name: 'otel-tui-demo',
  level: 'debug',
});

// --- Simulated service functions ---

async function fetchUserFromDb(userId: string) {
  return trace('db.users.find', async (ctx) => {
    ctx.setAttribute('user.id', userId);
    logger.info({ userId }, 'querying user from database');
    await delay(30 + jitter(20));
    logger.debug({ userId, cached: false }, 'user record loaded');
    return { id: userId, name: 'Alice', plan: 'pro' };
  });
}

async function checkInventory(items: string[]) {
  return trace('inventory.check', async (ctx) => {
    ctx.setAttribute('inventory.item_count', items.length);
    logger.info({ items }, 'checking inventory availability');
    await delay(50 + jitter(30));

    if (Math.random() > 0.7) {
      logger.warn({ sku: 'sku-c3' }, 'item low stock');
    }

    logger.debug({ items, allAvailable: true }, 'inventory check complete');
    return { available: true, items };
  });
}

async function chargePayment(amount: number) {
  return trace('payment.charge', async (ctx) => {
    ctx.setAttribute('payment.amount', amount);
    ctx.setAttribute('payment.currency', 'USD');

    logger.info({ amount, currency: 'USD' }, 'initiating payment charge');
    await delay(120 + jitter(50));

    if (Math.random() > 0.8) {
      const err = new Error('Payment declined by issuer');
      ctx.recordException(err);
      ctx.setStatus({ code: 2, message: err.message });
      logger.error({ amount, err }, 'payment charge failed');
      throw err;
    }

    const txId = `tx-${Date.now()}`;
    ctx.setAttribute('payment.transaction_id', txId);
    logger.info({ txId, amount }, 'payment charged successfully');
    return { transactionId: txId, amount };
  });
}

async function sendConfirmationEmail(orderId: string) {
  return trace('email.send', async (ctx) => {
    ctx.setAttribute('email.template', 'order-confirmation');
    ctx.setAttribute('order.id', orderId);
    logger.info({ template: 'order-confirmation', orderId }, 'sending confirmation email');
    await delay(40 + jitter(20));
    logger.debug('email queued for delivery');
  });
}

// --- Top-level order flow: creates a rich trace with nested spans ---

async function processOrder() {
  return trace('order.process', async (ctx) => {
    const orderId = `ord-${Date.now()}`;
    ctx.setAttribute('order.id', orderId);
    logger.info({ orderId }, 'starting order processing');

    // Step 1: fetch user
    const user = await fetchUserFromDb('u-1001');
    ctx.setAttribute('user.name', user.name);
    ctx.setAttribute('user.plan', user.plan);

    // Step 2: check inventory
    const items = ['sku-a1', 'sku-b2', 'sku-c3'];
    const inventory = await checkInventory(items);

    // Step 3: validate (inline span)
    await span({ name: 'order.validate' }, async (valCtx) => {
      logger.info({ orderId, user: user.name }, 'validating order');
      await delay(10);
      if (!inventory.available) {
        valCtx.setStatus({ code: 2, message: 'Items unavailable' });
        throw new Error('Items unavailable');
      }
      logger.debug({ orderId }, 'order validation passed');
    });

    // Step 4: charge payment
    const payment = await chargePayment(79.99);

    // Step 5: send confirmation
    await sendConfirmationEmail(orderId);

    ctx.setStatus({ code: 1 });
    logger.info({ orderId, txId: payment.transactionId }, 'order completed');
    return { orderId, transactionId: payment.transactionId };
  });
}

// --- Health check trace (short, simple) ---

async function healthCheck() {
  return trace('health.check', async (ctx) => {
    logger.debug('running health check');
    ctx.setAttribute('health.status', 'ok');
    await delay(5);
    logger.info({ status: 'ok', uptime: process.uptime() }, 'health check passed');
  });
}

// --- Main ---

async function main() {
  console.log('\n🔭 otel-tui demo — generating traces with correlated Pino logs\n');

  for (let i = 0; i < 3; i++) {
    try {
      const result = await processOrder();
      console.log(`  ✅ Order ${i + 1}: ${result.orderId}`);
    } catch (err) {
      console.log(`  ❌ Order ${i + 1}: ${(err as Error).message}`);
    }
    await delay(200);
  }

  await healthCheck();

  console.log('\n📤 Flushing telemetry...');
  await flush();
  await shutdown();
  console.log('✅ Done — check otel-tui for traces, spans, and correlated logs\n');
  process.exit(0);
}

// --- Helpers ---

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(max: number): number {
  return Math.floor(Math.random() * max);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
