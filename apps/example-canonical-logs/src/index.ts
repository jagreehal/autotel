/**
 * Canonical Log Lines Demo
 *
 * This demo shows the difference between regular logging and canonical log lines.
 *
 * Run with:
 *   npm run start:regular  - Shows traditional logging (many log lines, hard to query)
 *   npm run start:canonical - Shows canonical log lines (one wide event per request)
 *
 * The canonical log line approach implements Boris Tane's "wide events" pattern:
 * - One comprehensive log line per request with ALL context
 * - High-cardinality, high-dimensionality data for powerful queries
 * - Queryable as structured data instead of string search
 */

import { init, trace, setUser, httpServer } from 'autotel';
import pino from 'pino';
import { randomUUID } from 'node:crypto';

// Simulate a checkout request
interface CheckoutRequest {
  userId: string;
  cartId: string;
  items: Array<{ id: string; name: string; price: number }>;
  coupon?: string;
  paymentMethod: string;
}

// Parse command line args
const args = process.argv.slice(2);
const useCanonical = args.includes('--canonical') || !args.includes('--regular');

console.log('\n' + '='.repeat(80));
console.log(
  useCanonical
    ? '📋 CANONICAL LOG LINES MODE (Wide Events)'
    : '📝 REGULAR LOGGING MODE (Traditional)',
);
console.log('='.repeat(80) + '\n');

// Initialize autotel
const logger = pino({
  level: 'info',
  transport: useCanonical
    ? undefined // Canonical mode: structured JSON
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
});

init({
  service: 'checkout-api',
  logger,
  canonicalLogLines: useCanonical
    ? {
        enabled: true,
        rootSpansOnly: true, // One canonical log line per request
        logger, // Use Pino for canonical log lines
      }
    : undefined,
});

// Simulate user data
const users = {
  'user-123': {
    id: 'user-123',
    email: 'alice@example.com',
    subscription: 'premium',
    accountAgeDays: 847,
    lifetimeValueCents: 284700,
  },
  'user-456': {
    id: 'user-456',
    email: 'bob@example.com',
    subscription: 'free',
    accountAgeDays: 30,
    lifetimeValueCents: 0,
  },
};

// Simulate checkout processing
const processCheckout = trace((ctx) => async (req: CheckoutRequest) => {
  const user = users[req.userId as keyof typeof users];
  if (!user) {
    throw new Error(`User ${req.userId} not found`);
  }

  // Add user context (auto-enriched with traceId, spanId, correlationId)
  // Standard user attributes via setUser
  setUser(ctx, {
    id: user.id,
    email: user.email,
  });

  // Custom user attributes via setAttributes
  ctx.setAttributes({
    'user.subscription': user.subscription,
    'user.account_age_days': user.accountAgeDays,
    'user.lifetime_value_cents': user.lifetimeValueCents,
  });

  // Add HTTP context
  httpServer(ctx, {
    method: 'POST',
    route: '/api/checkout',
    statusCode: 200,
  });

  // Add business context as you process
  const total = req.items.reduce((sum, item) => sum + item.price, 0);
  const discount = req.coupon === 'SAVE20' ? total * 0.2 : 0;
  const finalTotal = total - discount;

  ctx.setAttributes({
    'cart.id': req.cartId,
    'cart.item_count': req.items.length,
    'cart.total_cents': Math.round(total * 100),
    'cart.discount_cents': Math.round(discount * 100),
    'cart.final_total_cents': Math.round(finalTotal * 100),
    'cart.coupon_applied': req.coupon || undefined,
    'payment.method': req.paymentMethod,
    'payment.provider': 'stripe',
  });

  // Simulate payment processing
  const paymentStart = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
  const paymentLatency = Date.now() - paymentStart;

  ctx.setAttributes({
    'payment.latency_ms': paymentLatency,
    'payment.attempt': 1,
  });

  // Simulate occasional payment failures
  if (Math.random() < 0.2) {
    const errorCode = ['card_declined', 'insufficient_funds', 'expired_card'][
      Math.floor(Math.random() * 3)
    ];
    ctx.setAttributes({
      'error.type': 'PaymentError',
      'error.code': errorCode,
      'error.retriable': errorCode !== 'expired_card',
    });
    throw new Error(`Payment failed: ${errorCode}`);
  }

  const orderId = randomUUID();
  ctx.setAttribute('order.id', orderId);

  return { orderId, total: finalTotal };
});

// Simulate multiple checkout requests
async function runDemo() {
  const requests: CheckoutRequest[] = [
    {
      userId: 'user-123',
      cartId: 'cart-1',
      items: [
        { id: 'item-1', name: 'Product A', price: 29.99 },
        { id: 'item-2', name: 'Product B', price: 49.99 },
      ],
      coupon: 'SAVE20',
      paymentMethod: 'card',
    },
    {
      userId: 'user-456',
      cartId: 'cart-2',
      items: [{ id: 'item-3', name: 'Product C', price: 19.99 }],
      paymentMethod: 'paypal',
    },
    {
      userId: 'user-123',
      cartId: 'cart-3',
      items: [
        { id: 'item-4', name: 'Product D', price: 99.99 },
        { id: 'item-5', name: 'Product E', price: 149.99 },
      ],
      paymentMethod: 'card',
    },
  ];

  console.log('Processing 3 checkout requests...\n');

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    try {
      const result = await processCheckout(req);
      if (!useCanonical) {
        // In regular mode, show multiple log lines
        logger.info({ userId: req.userId }, 'Checkout started');
        logger.info(
          { cartId: req.cartId, itemCount: req.items.length },
          'Cart loaded',
        );
        logger.info(
          { total: result.total, orderId: result.orderId },
          'Checkout completed',
        );
      }
      // In canonical mode, the canonical log line is automatically emitted
      // with ALL context (user, cart, payment, etc.)
    } catch (error) {
      if (!useCanonical) {
        logger.error({ err: error, userId: req.userId }, 'Checkout failed');
      }
      // In canonical mode, error is automatically captured in canonical log line
    }

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(80));
  if (useCanonical) {
    console.log('✅ CANONICAL LOG LINES MODE');
    console.log('\nBenefits:');
    console.log('  • One log line per request with ALL context');
    console.log('  • High-cardinality fields (user.id, order.id) for powerful queries');
    console.log('  • Queryable as structured data: WHERE user.id = "user-123"');
    console.log('  • No string search needed - all context in one place');
    console.log('\nTry querying:');
    console.log('  • All checkouts for premium users');
    console.log('  • All failed payments with error codes');
    console.log('  • All checkouts with coupons applied');
  } else {
    console.log('📝 REGULAR LOGGING MODE');
    console.log('\nLimitations:');
    console.log('  • Multiple log lines per request (hard to correlate)');
    console.log('  • Context scattered across log lines');
    console.log('  • Requires string search to find related logs');
    console.log('  • Difficult to query: need to grep and correlate manually');
  }
  console.log('='.repeat(80) + '\n');
}

runDemo().catch(console.error);

