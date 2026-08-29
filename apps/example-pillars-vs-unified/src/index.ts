/**
 * Three pillars (siloed) vs unified (wide event) demo.
 *
 * Same checkout failure, two ways of emitting telemetry.
 *
 *   pnpm start:pillars   — metric + scattered logs + bare span (three cabinets)
 *   pnpm start:unified   — one Autotel wide event with all context (one dossier)
 */

import { init, setUser, httpServer, withTracing, flush } from 'autotel';
import pino from 'pino';

const QUESTION =
  'Which payment.provider failed for user_456?';

const checkout = {
  userId: 'user_456',
  email: 'bob@example.com',
  subscription: 'free',
  cartId: 'cart-2',
  itemCount: 1,
  totalCents: 1999,
  paymentMethod: 'paypal',
  paymentProvider: 'paypal',
  errorCode: 'insufficient_funds',
  durationMs: 142,
  traceId: '7f3a9c1e2b4d6800',
  spanId: 'a1b2c3d4e5f60718',
} as const;

const mode = process.argv.includes('--pillars') ? 'pillars' : 'unified';

function printQuestion(answerable: boolean) {
  console.log('\n' + '-'.repeat(72));
  console.log(`Question: ${QUESTION}`);
  if (answerable) {
    console.log(`Answer:   payment.provider = "${checkout.paymentProvider}"`);
    console.log(
      'You read it off one event. No tab hopping, no timestamp stitching.',
    );
  } else {
    console.log('Answer:   unknown from this output alone.');
    console.log(
      'Metrics lost the user. Logs never named the provider. The span has no product fields.',
    );
  }
  console.log('-'.repeat(72) + '\n');
}

async function runPillars() {
  console.log('\n' + '='.repeat(72));
  console.log('THREE PILLARS MODE (siloed stores)');
  console.log('='.repeat(72));
  console.log(
    '\nImagine three tools. Each got a slice of the same failed checkout.\n',
  );

  console.log('--- METRICS STORE (aggregated; no individuals) ---');
  console.log(
    JSON.stringify(
      {
        metric: 'http.server.duration',
        unit: 'ms',
        labels: { route: '/api/checkout', status: '500' },
        p50: 89,
        p99: 210,
        // user id never appears: aggregates threw it away
      },
      null,
      2,
    ),
  );

  console.log('\n--- LOG STORE (scattered lines; inconsistent keys) ---');
  const lines = [
    `10:23:45.100 INFO  Checkout started userId=${checkout.userId}`,
    `10:23:45.150 DEBUG Cart loaded cartId=${checkout.cartId} items=${checkout.itemCount}`,
    `10:23:45.300 INFO  Payment processing method=${checkout.paymentMethod}`,
    `10:23:45.612 ERROR Payment failed error=${checkout.errorCode} customer=${checkout.userId}`,
  ];
  for (const line of lines) console.log(line);

  console.log('\n--- TRACE STORE (call graph; no product context) ---');
  console.log(
    JSON.stringify(
      {
        traceId: checkout.traceId,
        spans: [
          {
            spanId: checkout.spanId,
            name: 'POST /api/checkout',
            durationMs: checkout.durationMs,
            status: 'ERROR',
            attributes: {
              'http.route': '/api/checkout',
              'http.status_code': 500,
            },
          },
          {
            spanId: 'db99aabbccddeeff',
            parentSpanId: checkout.spanId,
            name: 'db.execute',
            durationMs: 89,
            status: 'OK',
            attributes: { 'db.system': 'postgres' },
          },
        ],
      },
      null,
      2,
    ),
  );

  printQuestion(false);
}

async function runUnified() {
  console.log('\n' + '='.repeat(72));
  console.log('UNIFIED MODE (one wide event + real span)');
  console.log('='.repeat(72));
  console.log(
    '\nSame failure. Autotel keeps user, cart, payment, and error on one event.\n',
  );

  const logger = pino({
    level: 'info',
    // structured JSON so the wide event is readable as data
  });

  init({
    service: 'checkout-api',
    logger,
    canonicalLogLines: {
      enabled: true,
      rootSpansOnly: true,
      logger,
    },
  });

  const processCheckout = withTracing({})((ctx) => async () => {
    setUser(ctx, {
      id: checkout.userId,
      email: checkout.email,
    });

    httpServer(ctx, {
      method: 'POST',
      route: '/api/checkout',
      statusCode: 500,
    });

    ctx.setAttributes({
      'user.subscription': checkout.subscription,
      'cart.id': checkout.cartId,
      'cart.item_count': checkout.itemCount,
      'cart.total_cents': checkout.totalCents,
      'payment.method': checkout.paymentMethod,
      'payment.provider': checkout.paymentProvider,
      'payment.latency_ms': checkout.durationMs,
      'error.type': 'PaymentError',
      'error.code': checkout.errorCode,
      'error.retriable': true,
    });

    throw new Error(`Payment failed: ${checkout.errorCode}`);
  });

  try {
    await processCheckout();
  } catch {
    // error lands on the span / canonical line
  }

  await flush();

  printQuestion(true);
}

async function main() {
  if (mode === 'pillars') {
    await runPillars();
  } else {
    await runUnified();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
