/**
 * Generates traffic for the collector pipeline in ../otelcol.yaml.
 *
 * The app exports every span. The collector decides what survives:
 * health checks are dropped, PII is masked, requests are counted before
 * a quarter of the non-error traces are kept.
 *
 * Run: pnpm start
 */

import {
  init,
  trace,
  span,
  getActiveTraceContext,
  flush,
  shutdown,
} from 'autotel';

const HEALTH_CHECKS = 30;
const ORDERS = 20;
const FAIL_EVERY = 5;

init({
  service: 'checkout-api',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  // Export every span and let the collector do the sampling. Autotel's default
  // preset already keeps 10% plus errors, and sampling in both places
  // multiplies: 10% here and 25% there leaves you 2.5%.
  sampling: 'development',
});

async function healthCheck() {
  return trace.run('GET /healthz', async (ctx) => {
    ctx.setAttribute('http.request.method', 'GET');
    ctx.setAttribute('http.route', '/healthz');
    ctx.setAttribute('http.response.status_code', 200);
    await delay(2);
  });
}

async function placeOrder(n: number) {
  return trace.run('POST /orders', async (ctx) => {
    const orderId = `ord-${String(n).padStart(4, '0')}`;

    ctx.setAttribute('http.request.method', 'POST');
    ctx.setAttribute('http.route', '/orders');
    ctx.setAttribute('order.id', orderId);

    // Two attributes this app should never have set. The collector masks both.
    ctx.setAttribute('user.email', 'alice.chen@example.com');
    ctx.setAttribute('payment.card', '4111111111111111');

    await span({ name: 'db.users.find' }, async () => {
      await delay(8 + jitter(6));
    });

    // Every fifth order fails. Tail sampling keeps all of them.
    if (n % FAIL_EVERY === 0) {
      ctx.setAttribute('http.response.status_code', 402);
      throw new Error('Payment declined by issuer');
    }

    await span({ name: 'payment.charge' }, async (paymentCtx) => {
      paymentCtx.setAttribute('payment.amount', 79.99);
      await delay(20 + jitter(15));
    });

    ctx.setAttribute('http.response.status_code', 201);
    return orderId;
  });
}

async function main() {
  console.log(
    `\nSending ${HEALTH_CHECKS} health checks and ${ORDERS} orders to the collector\n`,
  );

  for (let i = 0; i < HEALTH_CHECKS; i++) {
    await healthCheck();
  }

  let failed = 0;
  for (let n = 1; n <= ORDERS; n++) {
    try {
      await placeOrder(n);
    } catch {
      failed++;
    }
  }

  await flush();
  await shutdown();

  const sampled = ORDERS - failed;
  console.log(
    `Sent: ${HEALTH_CHECKS} health checks, ${ORDERS} orders (${failed} failed)\n`,
  );
  console.log('The collector should now show:');
  console.log(`  app.requests   ${ORDERS} for /orders, nothing for /healthz`);
  console.log(`  app.exceptions ${failed}`);
  console.log(
    `  traces stored  ${failed} failures + roughly ${Math.round(sampled * 0.25)} of the ${sampled} successes`,
  );
  console.log('  attributes     user.email masked, payment.card replaced\n');
  console.log(
    'Read the collector log:  docker compose logs otelcol | tail -20',
  );
  console.log('Browse the traces:       docker compose attach oteltui\n');
}

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
