/**
 * Bunyan Logger Example with autotel
 * 
 * This example demonstrates:
 * - Using Bunyan logger with autotel
 * - Bunyan auto-instrumentation for trace context injection
 * - Installing @opentelemetry/instrumentation-bunyan (required)
 * - Logging with trace context automatically injected
 * 
 * **Important:** While @opentelemetry/auto-instrumentations-node includes Bunyan
 * instrumentation, you should install @opentelemetry/instrumentation-bunyan separately
 * to ensure it's available and working correctly.
 * 
 * Run: pnpm start
 */

import 'dotenv/config';
import { init, trace, span, Metric, track, shutdown, type TraceContext } from 'autotel';

// Initialize autotel FIRST - this sets up Bunyan instrumentation
init({
  service: 'example-bunyan-service',
  debug: true,
  // Enable Bunyan auto-instrumentation to inject trace context into logs
  autoInstrumentations: ['bunyan'],
  // OTLP endpoint for Grafana (set via OTLP_ENDPOINT env var)
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});

// Create Bunyan logger AFTER init() - instrumentation will hook into it
import bunyan from 'bunyan';
const logger = bunyan.createLogger({
  name: 'example-bunyan',
  level: 'info',
  streams: [
    {
      stream: process.stdout,
    },
  ],
});

// Create a metrics instance
const metrics = new Metric('example-bunyan');

// ============================================================================
// Example: Basic traced function with Bunyan logging
// ============================================================================

export const createUser = trace((ctx) => async (name: string, email: string) => {
  // Bunyan signature: logger.info({ metadata }, 'message') - same as Pino!
  // Trace context (traceId, spanId) is automatically injected by auto-instrumentation!
  logger.info({ name, email }, 'Creating user');
  
  // Set span attributes
  ctx.setAttribute('user.name', name);
  ctx.setAttribute('user.email', email);
  
  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Track business metrics
  metrics.trackEvent('user.created', { name, email });
  
  // Track events event
  track('user.signup', { 
    userId: `user-${Date.now()}`, 
    name, 
    email,
    plan: 'free'
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
  
  // Simulate payment processing
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Randomly fail to demonstrate error tracking
  if (Math.random() > 0.7) {
    const error = new Error('Payment processing failed');
    ctx.setStatus({ code: 2, message: 'Payment failed' }); // ERROR
    ctx.recordException(error);
    logger.error({ 
      err: error,
      amount, 
      userId 
    }, 'Payment processing failed');
    throw error;
  }
  
  // Track successful payment
  metrics.trackEvent('payment.processed', { amount, userId });
  track('payment.completed', { amount, userId, currency: 'USD' });
  
  const transactionId = `tx-${Date.now()}`;
  logger.info({ transactionId, amount, userId }, 'Payment processed successfully');
  
  ctx.setStatus({ code: 1 }); // OK
  return { transactionId, amount, userId };
});

// ============================================================================
// Example: Nested traces
// ============================================================================

export const createOrder = trace((ctx: TraceContext) => async (userId: string, items: string[]) => {
  logger.info({ userId, itemCount: items.length }, 'Creating order');
  
  ctx.setAttribute('order.userId', userId);
  ctx.setAttribute('order.itemCount', items.length);
  
  // Create user (nested trace)
  const user = await createUser(`User-${userId}`, `user${userId}@example.com`);
  logger.info({ user }, 'User created for order');

  // Process payment (nested trace)
  const total = items.length * 10;
  const payment = await processPayment(total, userId);
  
  // Track order metrics
  metrics.trackEvent('order.created', { 
    userId, 
    itemCount: items.length, 
    total 
  });
  
  track('order.completed', { 
    orderId: payment.transactionId,
    userId, 
    itemCount: items.length,
    total 
  });
  
  logger.info({ 
    orderId: payment.transactionId,
    userId, 
    items, 
    total 
  }, 'Order created successfully');
  
  return { orderId: payment.transactionId, userId, items, total };
});

// ============================================================================
// Main function to run examples
// ============================================================================

async function main() {
  logger.info('🚀 Starting autotel Bunyan example...\n');

  try {
    // TEST: Verify trace() with nested span() doesn't create orphan spans
    logger.info('🔬 TEST: trace() with nested span() - should create exactly 2 spans');
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
        }
      );

      ctx.setAttributes({
        output: 'Successfully answered.',
      });
    });
    logger.info('✅ TEST PASSED: If you see exactly 2 spans (user-request-trace + llm-call) with same traceId, the fix works!\n');

    // Example 1: Create a user
    logger.info('📝 Example 1: Creating user');
    const user = await createUser('Alice', 'alice@example.com');
    logger.info({ user }, '✅ User created');
    
    // Example 2: Process payment
    logger.info('💳 Example 2: Processing payment');
    try {
      const payment = await processPayment(99.99, 'user-123');
      logger.info({ payment }, '✅ Payment processed');
    } catch (error) {
      logger.error({ err: error }, '❌ Payment failed (this is expected sometimes)');
    }
    
    // Example 3: Create order (nested traces)
    logger.info('🛒 Example 3: Creating order (with nested traces)');
    const order = await createOrder('user-456', ['item1', 'item2', 'item3']);
    logger.info({ order }, '✅ Order created');
    
    logger.info('✅ Examples completed!');
    
  } catch (error) {
    logger.error({ err: error }, '❌ Error:');
  }
  
  // Gracefully shutdown
  await shutdown();
  process.exit(0);
}

// Run if executed directly
main().catch(error => logger.error({ err: error }, '❌ Fatal error:'));
