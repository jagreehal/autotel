// Exercise the illustrative services end-to-end and write the resulting
// architecture snapshot to disk. The committed `snapshot.json` is the file
// that autotel-eventcatalog's generator will consume to produce (or refresh)
// the catalog you see under `catalog/`.
//
// Run with: pnpm services:snapshot

import { init } from 'autotel';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';

import { placeOrder } from './orders/index';
import { handleOrderPlaced } from './payments/index';
import { handlePaymentCaptured } from './inventory/index';
import { generateRecommendation } from './recommendations/index';
import type { PlaceOrderInput, OrderPlacedMessage } from './shared/types';

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

async function main() {
  for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
    await walkCheckout(orderFor(i, 'happy'));
  }

  const out = new URL('../test/snapshot.json', import.meta.url).pathname;
  await snapshot.writeToFile(out);
  console.log(`wrote architecture snapshot: ${out}`);
  console.log(JSON.stringify(snapshot.toSnapshot(), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
