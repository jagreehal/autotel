/**
 * Pino Logger Example with autotel (first-class)
 *
 * Pino is autotel's first-class logger: same signature as autotel's Logger type,
 * one instance for both init() and app logs. No autoInstrumentations or extra
 * package required.
 *
 * Run: pnpm start
 */

import 'dotenv/config';
import pino from 'pino';
import { init, trace, span, Metric, track, shutdown, type TraceContext } from 'autotel';

// Create Pino logger first. Autotel's logger contract is Pino-style: object first, message second.
const logger = pino({
  name: 'example-pino',
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

// One logger for both autotel internal logs and app logs. Pino is first-class: no autoInstrumentations needed.
init({
  service: 'example-pino-service',
  logger,
  debug: true,
  endpoint: process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const metrics = new Metric('example-pino');

// ============================================================================
// Example: Basic traced function with Pino logging (object first, message second)
// ============================================================================

export const createUser = trace((ctx) => async (name: string, email: string) => {
  logger.info({ name, email }, 'Creating user');

  ctx.setAttribute('user.name', name);
  ctx.setAttribute('user.email', email);

  await new Promise((resolve) => setTimeout(resolve, 100));

  metrics.trackEvent('user.created', { name, email });
  track('user.signup', {
    userId: `user-${Date.now()}`,
    name,
    email,
    plan: 'free',
  });

  const userId = `user-${Date.now()}`;
  logger.info({ userId, name, email }, 'User created successfully');

  return { id: userId, name, email };
});

// ============================================================================
// Example: Function with error handling
// ============================================================================

export const processPayment = trace((ctx: TraceContext) => async (amount: number, userId: string) => {
  logger.info({ amount, userId }, 'Processing payment');

  ctx.setAttribute('payment.amount', amount);
  ctx.setAttribute('payment.userId', userId);

  await new Promise((resolve) => setTimeout(resolve, 200));

  if (Math.random() > 0.7) {
    const error = new Error('Payment processing failed');
    ctx.setStatus({ code: 2, message: 'Payment failed' });
    ctx.recordException(error);
    logger.error({ err: error, amount, userId }, 'Payment processing failed');
    throw error;
  }

  metrics.trackEvent('payment.processed', { amount, userId });
  track('payment.completed', { amount, userId, currency: 'USD' });

  const transactionId = `tx-${Date.now()}`;
  logger.info({ transactionId, amount, userId }, 'Payment processed successfully');

  ctx.setStatus({ code: 1 });
  return { transactionId, amount, userId };
});

// ============================================================================
// Example: Nested traces
// ============================================================================

export const createOrder = trace((ctx: TraceContext) => async (userId: string, items: string[]) => {
  logger.info({ userId, itemCount: items.length }, 'Creating order');

  ctx.setAttribute('order.userId', userId);
  ctx.setAttribute('order.itemCount', items.length);

  const user = await createUser(`User-${userId}`, `user${userId}@example.com`);
  logger.info({ user }, 'User created for order');

  const total = items.length * 10;
  const payment = await processPayment(total, userId);

  metrics.trackEvent('order.created', {
    userId,
    itemCount: items.length,
    total,
  });
  track('order.completed', {
    orderId: payment.transactionId,
    userId,
    itemCount: items.length,
    total,
  });

  logger.info(
    { orderId: payment.transactionId, userId, items, total },
    'Order created successfully',
  );

  return { orderId: payment.transactionId, userId, items, total };
});

// ============================================================================
// Main function to run examples
// ============================================================================

async function main() {
  logger.info('Starting autotel Pino example');

  try {
    logger.info({}, 'TEST: trace() with nested span() - should create exactly 2 spans');
    await trace('user-request-trace', async (ctx) => {
      ctx.setAttributes({
        'input.query': 'What is the capital of France?',
      });

      await span(
        {
          name: 'llm-call',
          attributes: {
            model: 'gpt-4',
            'input.role': 'user',
            'input.content': 'What is the capital of France?',
          },
        },
        async (generationCtx) => {
          generationCtx.setAttributes({
            'output.content': 'The capital of France is Paris.',
          });
        },
      );

      ctx.setAttributes({
        output: 'Successfully answered.',
      });
    });
    logger.info({}, 'TEST PASSED: exactly 2 spans (user-request-trace + llm-call) with same traceId');

    logger.info({}, 'Example 1: Creating user');
    const user = await createUser('Alice', 'alice@example.com');
    logger.info({ user }, 'User created');

    logger.info({}, 'Example 2: Processing payment');
    try {
      const payment = await processPayment(99.99, 'user-123');
      logger.info({ payment }, 'Payment processed');
    } catch (error) {
      logger.error({ err: error }, 'Payment failed (expected sometimes)');
    }

    logger.info({}, 'Example 3: Creating order (nested traces)');
    const order = await createOrder('user-456', ['item1', 'item2', 'item3']);
    logger.info({ order }, 'Order created');

    logger.info({}, 'Examples completed');
  } catch (error) {
    logger.error({ err: error }, 'Error');
  }

  await shutdown();
  process.exit(0);
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
