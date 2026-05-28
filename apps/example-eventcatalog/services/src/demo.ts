// Demo entry point — wires the four illustrative services together so a single
// invocation walks the full checkout flow. Run with `pnpm services:demo` from
// the app root to emit traces that an autotel-eventcatalog generator would
// turn into the catalog you see under `catalog/`.

import { init } from 'autotel';
import { placeOrder } from './orders/index';
import { handleOrderPlaced } from './payments/index';
import { handlePaymentCaptured } from './inventory/index';
import { generateRecommendation } from './recommendations/index';
import type { PlaceOrderInput, OrderPlacedMessage } from './shared/types';

init({
  service: 'example-eventcatalog',
  // No exporter configured here — running this against a real OTLP collector
  // is left to the integrator. To capture an architecture snapshot from this
  // demo, run `pnpm services:snapshot` instead (see `build-snapshot.ts`),
  // which wires in `ArchitectureSnapshotSubscriber` from autotel-subscribers.
});

async function main() {
  const order: PlaceOrderInput = {
    id: crypto.randomUUID(),
    customerId: crypto.randomUUID(),
    totalCents: 8499,
    currency: 'GBP',
    items: [
      { sku: 'sku-101', quantity: 1, priceCents: 5499 },
      { sku: 'sku-202', quantity: 1, priceCents: 3000 },
    ],
    shipping: { addressId: 'addr_demo' },
    metadata: { source: 'web' },
  };

  await placeOrder(order);

  const placedMessage: OrderPlacedMessage = { type: 'OrderPlaced', ...order };
  await Promise.all([
    handleOrderPlaced(placedMessage),
    generateRecommendation(placedMessage),
  ]);

  await handlePaymentCaptured({ orderId: order.id, items: order.items });

  console.log('demo: checkout flow completed for order', order.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
