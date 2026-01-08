/**
 * Wide Event Builder API
 *
 * This API mirrors Boris Tane's 6-step "Wide Event Builder Simulator"
 * from loggingsucks.com. Each endpoint adds context to a checkout session,
 * and the final endpoint emits a single canonical log line with ALL context.
 *
 * Run: pnpm start:server
 * Demo: ./demo.sh
 */

import 'dotenv/config';
import express from 'express';
import { trace, setUser, httpServer, type TraceContext } from 'autotel';

const app = express();
app.use(express.json());

// In-memory session store for checkout sessions
interface CheckoutSession {
  request_id: string;
  timestamp: string;
  startTime: number;
  step: number;
  attributes: Record<string, unknown>;
}

const sessions = new Map<string, CheckoutSession>();

// Simulated user database (matching Boris's example)
const users: Record<string, {
  id: string;
  subscription: string;
  account_age_days: number;
  lifetime_value_cents: number;
}> = {
  user_456: {
    id: 'user_456',
    subscription: 'premium',
    account_age_days: 847,
    lifetime_value_cents: 284700,
  },
  user_123: {
    id: 'user_123',
    subscription: 'free',
    account_age_days: 30,
    lifetime_value_cents: 0,
  },
};

// Simulated cart database
const carts: Record<string, {
  id: string;
  item_count: number;
  total_cents: number;
  coupon_applied?: string;
}> = {
  cart_xyz: {
    id: 'cart_xyz',
    item_count: 3,
    total_cents: 15999,
    coupon_applied: 'SAVE20',
  },
};

/**
 * Step 1: Request Received
 * Initialize event with request context
 */
app.post('/checkout/start', (req, res) => {
  const { request_id } = req.body;

  if (!request_id) {
    return res.status(400).json({ error: 'request_id is required' });
  }

  const session: CheckoutSession = {
    request_id,
    timestamp: new Date().toISOString(),
    startTime: Date.now(),
    step: 1,
    attributes: {
      request_id,
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/api/checkout',
      service: 'checkout-service',
    },
  };

  sessions.set(request_id, session);

  res.json({
    step: 'Step 1 of 6: Request Received',
    description: 'Initialize event with request context',
    field_count: Object.keys(session.attributes).length,
    event: session.attributes,
    comparison: {
      traditional: '1 log line: "Checkout started"',
      wide_event: `1 event, ${Object.keys(session.attributes).length} fields`,
    },
  });
});

/**
 * Step 2: User Authenticated
 * Add user context from auth middleware
 */
app.post('/checkout/auth', (req, res) => {
  const { request_id, user_id } = req.body;

  const session = sessions.get(request_id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found. Call /checkout/start first.' });
  }

  const user = users[user_id] || users['user_456'];

  session.step = 2;
  session.attributes = {
    ...session.attributes,
    user: {
      id: user.id,
      subscription: user.subscription,
      account_age_days: user.account_age_days,
      lifetime_value_cents: user.lifetime_value_cents,
    },
  };

  const fieldCount = countFields(session.attributes);

  res.json({
    step: 'Step 2 of 6: User Authenticated',
    description: 'Add user context from auth middleware',
    field_count: fieldCount,
    event: session.attributes,
    comparison: {
      traditional: '2 separate log lines, hard to correlate',
      wide_event: `1 event, ${fieldCount} fields`,
    },
  });
});

/**
 * Step 3: Cart Loaded
 * Add business context from cart service
 */
app.post('/checkout/cart', (req, res) => {
  const { request_id, cart_id } = req.body;

  const session = sessions.get(request_id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found. Call /checkout/start first.' });
  }

  const cart = carts[cart_id] || carts['cart_xyz'];

  session.step = 3;
  session.attributes = {
    ...session.attributes,
    cart: {
      id: cart.id,
      item_count: cart.item_count,
      total_cents: cart.total_cents,
      coupon_applied: cart.coupon_applied,
    },
  };

  const fieldCount = countFields(session.attributes);

  res.json({
    step: 'Step 3 of 6: Cart Loaded',
    description: 'Add business context from cart service',
    field_count: fieldCount,
    event: session.attributes,
    comparison: {
      traditional: '3 separate log lines, impossible to correlate',
      wide_event: `1 event, ${fieldCount} fields`,
    },
  });
});

/**
 * Step 4: Payment Processing
 * Start payment and record timing
 */
app.post('/checkout/payment', async (req, res) => {
  const { request_id, payment_method = 'card', provider = 'stripe' } = req.body;

  const session = sessions.get(request_id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found. Call /checkout/start first.' });
  }

  // Simulate payment processing latency
  const paymentStart = Date.now();
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
  const paymentLatency = Date.now() - paymentStart;

  session.step = 4;
  session.attributes = {
    ...session.attributes,
    payment: {
      method: payment_method,
      provider,
      latency_ms: paymentLatency,
      attempt: 1,
    },
  };

  const fieldCount = countFields(session.attributes);

  res.json({
    step: 'Step 4 of 6: Payment Processing',
    description: 'Start payment and record timing',
    field_count: fieldCount,
    event: session.attributes,
    comparison: {
      traditional: '4 separate log lines, impossible to correlate',
      wide_event: `1 event, ${fieldCount} fields`,
    },
  });
});

/**
 * Step 5-6: Complete Checkout
 * Finalize with duration and status, emit canonical log line
 *
 * Pass ?simulate_error=true to simulate a payment failure
 */
const processCheckout = trace((ctx: TraceContext) => async (session: CheckoutSession, simulateError: boolean) => {
  // Set all accumulated attributes on the span
  httpServer(ctx, {
    method: 'POST',
    route: '/api/checkout',
    statusCode: simulateError ? 500 : 200,
  });

  // User context
  const user = session.attributes.user as Record<string, unknown> | undefined;
  if (user) {
    setUser(ctx, {
      id: user.id as string,
    });
    ctx.setAttributes({
      'user.subscription': user.subscription,
      'user.account_age_days': user.account_age_days,
      'user.lifetime_value_cents': user.lifetime_value_cents,
    });
  }

  // Request context
  ctx.setAttributes({
    'request.id': session.request_id,
  });

  // Cart context
  const cart = session.attributes.cart as Record<string, unknown> | undefined;
  if (cart) {
    ctx.setAttributes({
      'cart.id': cart.id,
      'cart.item_count': cart.item_count,
      'cart.total_cents': cart.total_cents,
      'cart.coupon_applied': cart.coupon_applied,
    });
  }

  // Payment context
  const payment = session.attributes.payment as Record<string, unknown> | undefined;
  if (payment) {
    ctx.setAttributes({
      'payment.method': payment.method,
      'payment.provider': payment.provider,
      'payment.latency_ms': payment.latency_ms,
      'payment.attempt': payment.attempt,
    });
  }

  // Simulate error if requested
  if (simulateError) {
    ctx.setAttributes({
      'error.type': 'PaymentError',
      'error.code': 'card_declined',
      'error.message': 'Card declined by issuer',
      'error.stripe_decline_code': 'insufficient_funds',
    });
    throw new Error('Payment failed: card_declined');
  }

  return { success: true };
});

app.post('/checkout/complete', async (req, res) => {
  const { request_id, simulate_error = false } = req.body;

  const session = sessions.get(request_id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found. Call /checkout/start first.' });
  }

  const duration_ms = Date.now() - session.startTime;

  // Add final fields
  session.attributes = {
    ...session.attributes,
    duration_ms,
    status_code: simulate_error ? 500 : 200,
    outcome: simulate_error ? 'error' : 'success',
  };

  if (simulate_error) {
    session.attributes.error = {
      type: 'PaymentError',
      code: 'card_declined',
      message: 'Card declined by issuer',
      stripe_decline_code: 'insufficient_funds',
    };
  }

  const fieldCount = countFields(session.attributes);

  // Execute the traced function to emit canonical log line
  try {
    await processCheckout(session, simulate_error);
  } catch {
    // Error is expected when simulating failure - canonical log still emits
  }

  // Clean up session
  sessions.delete(request_id);

  const stepName = simulate_error
    ? 'Step 5-6 of 6: Payment Failed + Event Emitted'
    : 'Step 5-6 of 6: Success + Event Emitted';

  res.json({
    step: stepName,
    description: 'Finalize with duration and status, emit canonical log line',
    field_count: fieldCount,
    event: session.attributes,
    canonical_log_emitted: true,
    comparison: {
      traditional: `6 separate log statements, impossible to correlate`,
      wide_event: `1 event, ${fieldCount} fields, complete picture, trivially queryable`,
    },
    message: 'Check the server console for the canonical log line!',
  });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Reset all sessions (for demo purposes)
 */
app.post('/reset', (req, res) => {
  sessions.clear();
  res.json({ message: 'All sessions cleared' });
});

// Helper: count nested fields
function countFields(obj: Record<string, unknown>, prefix = ''): number {
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      count += countFields(value as Record<string, unknown>, `${prefix}${key}.`);
    } else {
      count++;
    }
  }
  return count;
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(70));
  console.log('Wide Event Builder API');
  console.log('Demonstrates canonical log lines (Boris Tane\'s wide events pattern)');
  console.log('='.repeat(70));
  console.log(`\nServer running on http://localhost:${PORT}`);
  console.log('\nEndpoints (call in order):');
  console.log('  POST /checkout/start     - Step 1: Initialize request');
  console.log('  POST /checkout/auth      - Step 2: Add user context');
  console.log('  POST /checkout/cart      - Step 3: Add cart context');
  console.log('  POST /checkout/payment   - Step 4: Process payment');
  console.log('  POST /checkout/complete  - Step 5-6: Finalize + emit log');
  console.log('\nRun ./demo.sh to step through the flow automatically');
  console.log('='.repeat(70) + '\n');
});
