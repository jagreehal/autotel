/**
 * Basic example demonstrating autotel
 * 
 * This example shows:
 * - Basic tracing with trace()
 * - Metrics tracking
 * - Events events
 * - Custom attributes
 * 
 * Run: pnpm start
 */

import 'dotenv/config';
import { init, trace, Metric, track, shutdown, type TraceContext } from 'autotel';

import pino from 'pino';

const logger = pino({
  name: 'example',
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

// Initialize autotel
init({
  service: 'example-service',
  logger,
  debug: true,
  // OTLP endpoint for Grafana (set via OTLP_ENDPOINT env var)
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});

// Create a metrics instance
const metrics = new Metric('example');

// Example: Basic traced function
export const createUser = trace((ctx) => async (name: string, email: string) => {
  logger.info(`Creating user: ${name} (${email})`);
  
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
  
  return { id: `user-${Date.now()}`, name, email };
});

// Example: Function with error handling
export const processPayment = trace((ctx: TraceContext) => async (amount: number, userId: string) => {
  logger.info(`Processing payment: $${amount} for user ${userId}`);
  
  ctx.setAttribute('payment.amount', amount);
  ctx.setAttribute('payment.userId', userId);
  
  // Simulate payment processing
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Randomly fail to demonstrate error tracking
  if (Math.random() > 0.7) {
    ctx.setStatus({ code: 2, message: 'Payment failed' }); // ERROR
    ctx.recordException(new Error('Payment processing failed'));
    throw new Error('Payment processing failed');
  }
  
  // Track successful payment
  metrics.trackEvent('payment.processed', { amount, userId });
  track('payment.completed', { amount, userId, currency: 'USD' });
  
  ctx.setStatus({ code: 1 }); // OK
  return { transactionId: `tx-${Date.now()}`, amount, userId };
});

// Example: Nested traces
export const createOrder = trace((ctx: TraceContext) => async (userId: string, items: string[]) => {
  logger.info(`Creating order for user ${userId} with ${items.length} items`);
  
  ctx.setAttribute('order.userId', userId);
  ctx.setAttribute('order.itemCount', items.length);
  
  // Create user (nested trace)
  const user = await createUser(`User-${userId}`, `user${userId}@example.com`);
  logger.info({ user }, '✅ User created');

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
  
  return { orderId: payment.transactionId, userId, items, total };
});

// Main function to run examples
async function main() {
  logger.info('🚀 Starting autotel example...\n');
  
  try {
    // Example 1: Create a user
    logger.info('📝 Example 1: Creating user');
    const user = await createUser('Alice', 'alice@example.com');
    logger.info({ user }, '✅ User created:');
    
    // Example 2: Process payment
    logger.info('💳 Example 2: Processing payment');
    try {
      const payment = await processPayment(99.99, 'user-123');
      logger.info({ payment }, '✅ Payment processed:');
    } catch (error) {
      logger.error(error, '❌ Payment failed (this is expected sometimes)');
    }
    
    // Example 3: Create order (nested traces)
    logger.info('🛒 Example 3: Creating order (with nested traces)');
    const order = await createOrder('user-456', ['item1', 'item2', 'item3']);
    logger.info({ order }, '✅ Order created:');
    
    // Wait a bit for traces to be exported
    
    logger.info('✅ Examples completed!');
    
  } catch (error) {
    logger.error(error, '❌ Error:');
  }
  
  // Gracefully shutdown
  await shutdown();
  process.exit(0);
}

// Run if executed directly
main().catch(error => logger.error(error, '❌ Error:'));

