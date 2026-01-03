/**
 * Terminal Dashboard Example
 *
 * This example demonstrates the autotel-terminal dashboard for viewing
 * OpenTelemetry traces in real-time.
 *
 * Features:
 * - Real-time span streaming
 * - Interactive dashboard with keyboard controls
 * - Error filtering
 * - Live statistics
 *
 * Run: pnpm start
 *
 * Controls:
 * - ↑/↓: Navigate spans
 * - p: Pause/resume
 * - e: Toggle error-only filter
 * - c: Clear spans
 * - Ctrl+C: Exit
 */

import 'dotenv/config';
import { init, trace, span } from 'autotel';
import {
  renderTerminal,
  StreamingSpanProcessor,
  createTerminalSpanStream,
} from 'autotel-terminal';

// Create the streaming processor for the terminal dashboard
// This captures spans as they complete and streams them to the dashboard
const streamingProcessor = new StreamingSpanProcessor(null);

// Initialize autotel with the streaming processor
init({
  service: 'example-terminal',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  debug: false, // Set to true for more verbose logging
  // Add the streaming processor to capture spans for the dashboard
  spanProcessors: [streamingProcessor],
});

// Create the stream from the processor
const terminalStream = createTerminalSpanStream(streamingProcessor);

// Launch terminal dashboard
console.log('🚀 Starting terminal dashboard...');
console.log('📊 Dashboard will show traces in real-time\n');
console.log('Controls:');
console.log('  ↑/↓ - Navigate spans');
console.log('  p   - Pause/resume');
console.log('  e   - Toggle error-only filter');
console.log('  c   - Clear spans');
console.log('  Ctrl+C - Exit\n');

renderTerminal(
  {
    title: 'Example Terminal Dashboard',
    showStats: true,
    maxSpans: 100,
  },
  terminalStream,
);

// Give the dashboard a moment to initialize
await new Promise((resolve) => setTimeout(resolve, 500));

// Example traced functions
const fetchUser = trace({ name: 'fetchUser' }, (ctx) => async (userId: string) => {
  ctx.setAttribute('user.id', userId);
  ctx.setAttribute('http.method', 'GET');
  ctx.setAttribute('http.route', '/api/users/:id');

  // Simulate API call
  await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));

  return {
    id: userId,
    name: `User ${userId}`,
    email: `user${userId}@example.com`,
  };
});

const processOrder = trace({ name: 'processOrder' }, (ctx) => async (orderId: string, items: string[]) => {
  ctx.setAttribute('order.id', orderId);
  ctx.setAttribute('order.itemCount', items.length);

  // Nested span: validate inventory
  await span({ name: 'validate.inventory' }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  // Nested span: calculate total
  const total = await span({ name: 'calculate.total' }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return items.length * 10;
  });

  ctx.setAttribute('order.total', total);

  // Simulate processing
  await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

  return { orderId, items, total };
});

const processPayment = trace({ name: 'processPayment' }, (ctx) => async (amount: number, userId: string) => {
  ctx.setAttribute('payment.amount', amount);
  ctx.setAttribute('payment.userId', userId);
  ctx.setAttribute('payment.currency', 'USD');

  // Simulate payment processing
  await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 120));

  // Randomly fail to demonstrate error tracking
  if (Math.random() > 0.75) {
    ctx.setStatus({ code: 2, message: 'Payment failed' });
    ctx.recordException(new Error('Insufficient funds'));
    throw new Error('Payment processing failed');
  }

  ctx.setStatus({ code: 1 }); // OK
  return { transactionId: `tx-${Date.now()}`, amount, userId };
});

// Generate traces continuously
async function generateTraces() {
  const userIds = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'];
  const items = [
    ['item-a', 'item-b'],
    ['item-c'],
    ['item-d', 'item-e', 'item-f'],
    ['item-g'],
  ];

  let iteration = 0;

  while (true) {
    iteration++;
    const delay = 1000 + Math.random() * 2000; // 1-3 seconds

    try {
      // Simulate different operations
      const operation = Math.floor(Math.random() * 3);

      if (operation === 0) {
        // Fetch user
        const userId = userIds[Math.floor(Math.random() * userIds.length)]!;
        await fetchUser(userId);
      } else if (operation === 1) {
        // Process order
        const orderItems = items[Math.floor(Math.random() * items.length)]!;
        const orderId = `order-${Date.now()}`;
        await processOrder(orderId, orderItems);
      } else {
        // Process payment (may fail)
        const amount = Math.floor(Math.random() * 100) + 10;
        const userId = userIds[Math.floor(Math.random() * userIds.length)]!;
        try {
          await processPayment(amount, userId);
        } catch (error) {
          // Error is expected sometimes
        }
      }
    } catch (error) {
      // Continue generating traces even if one fails
    }

    // Wait before next iteration
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// Start generating traces
generateTraces().catch((error) => {
  console.error('Error generating traces:', error);
  process.exit(1);
});
