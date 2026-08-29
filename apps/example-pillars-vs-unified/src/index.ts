/**
 * Three pillars (siloed) vs unified (wide event) demo.
 *
 * Same checkout failure, two ways of emitting telemetry.
 *
 *   pnpm start:pillars   — metric + scattered logs + bare span (three cabinets)
 *   pnpm start:unified   — one Autotel wide event with all context (one dossier)
 */

import assert from 'node:assert/strict';
import { init, setUser, httpServer, withTracing, flush } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import pino from 'pino';

const QUESTION = 'Which payment.provider failed for user_456?';

/**
 * One thing a store holds: a metric point, a log line, a span, a wide event.
 *
 * The demo collects these as data, not just as printed output, so the question
 * below is answered by a function rather than by the narrator.
 */
type FieldValue = string | number | boolean;

interface TelemetryRecord {
  /** Where an investigator would have to look to find this. */
  store: string;
  /** Flat, the way a store holds a row you can filter on. */
  fields: Record<string, FieldValue>;
}

/**
 * Answer the question the way an investigator can without joining tools by
 * hand: find one record that names the user and the payment provider together.
 *
 * Anything looser would be the manual correlation the whole post is about.
 *
 * The provider must be its own field, but the user only has to appear
 * somewhere in the record: that is deliberately generous to the pillars, so a
 * user id buried in a log sentence still counts as "the log store knew".
 */
type Answer = { store: string; provider: string } | null;

function answerFrom(records: TelemetryRecord[]): Answer {
  for (const record of records) {
    const provider = record.fields['payment.provider'];
    const namesUser = JSON.stringify(record.fields).includes(checkout.userId);
    if (provider !== undefined && namesUser) {
      return { store: record.store, provider: String(provider) };
    }
  }
  return null;
}

/** How close each store got, which is the size of the join you would do by hand. */
function nearMisses(records: TelemetryRecord[]) {
  const namingUser = records.filter((r) =>
    JSON.stringify(r.fields).includes(checkout.userId),
  );
  const withProvider = records.filter(
    (r) => r.fields['payment.provider'] !== undefined,
  );
  return { namingUser, withProvider };
}

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

function report(records: TelemetryRecord[]): Answer {
  const answer = answerFrom(records);
  const { namingUser, withProvider } = nearMisses(records);

  console.log('\n' + '-'.repeat(72));
  console.log(`Question: ${QUESTION}`);
  if (answer) {
    console.log(`Answer:   payment.provider = "${answer.provider}"`);
    console.log(`Read off one record in the ${answer.store}. No tab hopping.`);
  } else {
    console.log('Answer:   unknown from this output alone.');
    console.log(
      `${records.length} records: ${namingUser.length} name the user ` +
        `(${namingUser.map((r) => r.store).join(', ') || 'none'}), ` +
        `${withProvider.length} carry payment.provider. No record has both.`,
    );
  }
  console.log('-'.repeat(72) + '\n');
  return answer;
}

async function runPillars(): Promise<Answer> {
  console.log('\n' + '='.repeat(72));
  console.log('THREE PILLARS MODE (siloed stores)');
  console.log('='.repeat(72));
  console.log(
    '\nImagine three tools. Each got a slice of the same failed checkout.\n',
  );

  const records: TelemetryRecord[] = [];

  // The user id never appears: aggregates threw it away.
  const metricPoint = {
    metric: 'http.server.duration',
    unit: 'ms',
    labels: { route: '/api/checkout', status: '500' },
    p50: 89,
    p99: 210,
  };
  records.push({
    store: 'metrics store',
    fields: {
      metric: metricPoint.metric,
      route: metricPoint.labels.route,
      status: metricPoint.labels.status,
      p50: metricPoint.p50,
      p99: metricPoint.p99,
    },
  });

  console.log('--- METRICS STORE (aggregated; no individuals) ---');
  console.log(JSON.stringify(metricPoint, null, 2));

  console.log('\n--- LOG STORE (scattered lines; inconsistent keys) ---');
  const lines = [
    `10:23:45.100 INFO  Checkout started userId=${checkout.userId}`,
    `10:23:45.150 DEBUG Cart loaded cartId=${checkout.cartId} items=${checkout.itemCount}`,
    `10:23:45.300 INFO  Payment processing method=${checkout.paymentMethod}`,
    `10:23:45.612 ERROR Payment failed error=${checkout.errorCode} customer=${checkout.userId}`,
  ];
  for (const line of lines) {
    console.log(line);
    // Parse the `key=value` pairs the way a log tool would, so the search
    // below looks at fields rather than at a sentence.
    const pairs: [string, string][] = [];
    for (const match of line.matchAll(/(\w+)=(\S+)/g)) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) pairs.push([key, value]);
    }
    records.push({
      store: 'log store',
      fields: Object.fromEntries([['message', line], ...pairs]),
    });
  }

  const spans: {
    spanId: string;
    parentSpanId?: string;
    name: string;
    durationMs: number;
    status: string;
    attributes: Record<string, FieldValue>;
  }[] = [
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
  ];
  for (const span of spans) {
    records.push({
      store: 'trace store',
      fields: {
        spanId: span.spanId,
        name: span.name,
        durationMs: span.durationMs,
        status: span.status,
        ...span.attributes,
      },
    });
  }

  console.log('\n--- TRACE STORE (call graph; no product context) ---');
  console.log(JSON.stringify({ traceId: checkout.traceId, spans }, null, 2));

  return report(records);
}

async function runUnified(): Promise<Answer> {
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

  // The exporter is how the demo reads back what a backend would receive,
  // rather than trusting the sentence it prints.
  const exporter = createMemoryExporter();

  init({
    service: 'checkout-api',
    logger,
    spanExporters: [exporter],
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

  const records: TelemetryRecord[] = exporter.spans().map((span) => ({
    store: 'wide event',
    fields: Object.fromEntries(
      Object.entries(span.attributes).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, value as FieldValue]],
      ),
    ),
  }));

  return report(records);
}

async function main() {
  if (mode === 'pillars') {
    const answer = await runPillars();
    // The claim this mode makes: no single record answers the question. If a
    // future change puts the user and the provider on the same record, this
    // fails and the demo is telling the truth again.
    assert.equal(
      answer,
      null,
      'siloed telemetry should not be able to answer the question',
    );
    console.log(
      'Asserted: no single record names both the user and the provider.\n',
    );
    return;
  }

  const answer = await runUnified();
  assert.ok(answer, 'the wide event should answer the question on its own');
  assert.equal(answer?.provider, checkout.paymentProvider);
  console.log(
    'Asserted: one record carries the user and the provider, and it is the right one.\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
