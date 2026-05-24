// Exercise the illustrative services end-to-end and write the resulting
// architecture snapshot to disk. The committed `snapshot.json` is the file
// that autotel-eventcatalog's generator will consume to produce (or refresh)
// the catalog you see under `catalog/`.
//
// Run with: pnpm services:snapshot

import { init } from 'autotel';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';

import { placeOrder } from './orders/index';
import { handleOrderPlaced, setStripeStub } from './payments/index';
import { handlePaymentCaptured, setWmsStub } from './inventory/index';
import { generateRecommendation } from './recommendations/index';
import { setIsoClock } from './shared/clock';
import type { PlaceOrderInput, OrderPlacedMessage } from './shared/types';

// Deterministic counters so the committed snapshot's fieldStats.sampleValues
// stay byte-stable across regenerations. The architectural shape (event
// names, field paths, types, producer/consumer/channel edges) is what we
// care about; exact id strings and wall-clock timestamps are not.

let isoTick = 0;
setIsoClock(() => {
  const ms = String(isoTick++).padStart(3, '0');
  return `2026-05-22T00:00:00.${ms}Z`;
});

let stripeSeq = 0;
setStripeStub({
  charges: {
    create: async () => ({
      status: 'succeeded',
      pspTransactionId: `ch_seed_${String(stripeSeq++).padStart(4, '0')}`,
    }),
  },
});

let wmsSeq = 0;
setWmsStub({
  reserve: async () => ({
    id: `rsv_seed_${String(wmsSeq++).padStart(4, '0')}`,
  }),
});

const snapshot = new ArchitectureSnapshotSubscriber({
  service: 'example-eventcatalog',
});

init({
  service: 'example-eventcatalog',
  subscribers: [snapshot],
});

const RUNS_PER_SCENARIO = 5;

function orderFor(i: number, scenario: string): PlaceOrderInput {
  return {
    id: `order-${scenario}-${i}`,
    customerId: `customer-${i}`,
    totalCents: 8499 + i * 100,
    currency: 'GBP',
    items: [
      { sku: 'sku-101', quantity: 1, priceCents: 5499 },
      { sku: 'sku-202', quantity: 1, priceCents: 3000 },
    ],
    shipping: { addressId: 'addr_demo' },
    metadata: { source: 'web' },
  };
}

async function walkCheckout(order: PlaceOrderInput) {
  await placeOrder(order);
  const msg: OrderPlacedMessage = { type: 'OrderPlaced', ...order };
  await Promise.all([handleOrderPlaced(msg), generateRecommendation(msg)]);
  await handlePaymentCaptured({ orderId: order.id, items: order.items });
}

async function walkFailedCheckout(order: PlaceOrderInput) {
  // Force a hard decline so the retry loop exits and `payment.failed` fires.
  setStripeStub({
    charges: {
      create: async () => ({
        status: 'declined',
        declineCode: 'card_declined',
        soft: false,
      }),
    },
  });
  await placeOrder(order);
  const msg: OrderPlacedMessage = { type: 'OrderPlaced', ...order };
  await handleOrderPlaced(msg);
}

async function main() {
  for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
    await walkCheckout(orderFor(i, 'happy'));
  }

  // Exercise the failure path so the snapshot covers `payment.failed`.
  for (let i = 0; i < 2; i++) {
    await walkFailedCheckout(orderFor(i, 'fail'));
  }

  // Pin generatedAt too, for the same determinism reason. The CI check
  // strips this on both sides, but locally a stable value makes git diffs
  // cleaner.
  const out = new URL('../test/snapshot.json', import.meta.url).pathname;
  await snapshot.writeToFile(out, {
    now: () => new Date('2026-05-22T00:00:00.000Z'),
  });
  console.log(`wrote architecture snapshot: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
