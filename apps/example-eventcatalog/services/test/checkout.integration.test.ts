// Integration test that exercises the checkout services and asserts that the
// architecture snapshot captures everything the catalog claims to be observing.
//
// This is the contract between the code and the catalog: if a test passes,
// the snapshot will name the events the catalog expects, with the channel
// and producer attribution the catalog renders.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { init } from 'autotel';
import {
  ArchitectureSnapshotSubscriber,
  ARCHITECTURE_SNAPSHOT_SPEC,
} from 'autotel-subscribers/architecture-snapshot';

import { placeOrder } from '../src/orders/index';
import { handleOrderPlaced } from '../src/payments/index';
import { handlePaymentCaptured } from '../src/inventory/index';
import { generateRecommendation } from '../src/recommendations/index';
import type { PlaceOrderInput, OrderPlacedMessage } from '../src/shared/types';

const snapshot = new ArchitectureSnapshotSubscriber({
  service: 'example-eventcatalog',
});

beforeAll(() => {
  init({
    service: 'example-eventcatalog',
    subscribers: [snapshot],
  });
});

afterAll(() => {
  snapshot.reset();
});

const sampleOrder: PlaceOrderInput = {
  id: 'order-integration-1',
  customerId: 'customer-1',
  totalCents: 8499,
  currency: 'GBP',
  items: [
    { sku: 'sku-101', quantity: 1, priceCents: 5499 },
    { sku: 'sku-202', quantity: 1, priceCents: 3000 },
  ],
  shipping: { addressId: 'addr_demo' },
  metadata: { source: 'web' },
};

describe('checkout flow → architecture snapshot', () => {
  it('captures every event the CheckoutFlow page claims to observe', async () => {
    await placeOrder(sampleOrder);
    const msg: OrderPlacedMessage = { type: 'OrderPlaced', ...sampleOrder };
    await Promise.all([handleOrderPlaced(msg), generateRecommendation(msg)]);
    await handlePaymentCaptured({ orderId: sampleOrder.id, items: sampleOrder.items });

    const snap = snapshot.toSnapshot();

    expect(snap.spec).toBe(ARCHITECTURE_SNAPSHOT_SPEC);
    expect(Object.keys(snap.events).sort()).toEqual([
      'inventory.reserved',
      'order.placed',
      'payment.captured',
      'recommendation.generated',
    ]);
  });

  it('attributes each event to the correct service and channel', () => {
    const events = snapshot.toSnapshot().events;
    expect(events['order.placed']).toMatchObject({
      producer: 'OrdersService',
      channel: 'orders.events',
    });
    expect(events['payment.captured']).toMatchObject({
      producer: 'PaymentService',
      channel: 'payments.events',
    });
    expect(events['inventory.reserved']).toMatchObject({
      producer: 'InventoryService',
      channel: 'inventory.events',
    });
    expect(events['recommendation.generated']).toMatchObject({
      producer: 'RecommendationsService',
      channel: 'orders.events',
    });
  });

  it('captures payload field paths so drift can be detected later', () => {
    const orderPlaced = snapshot.toSnapshot().events['order.placed'];
    expect(orderPlaced.fieldPaths).toEqual(
      expect.arrayContaining([
        'orderId',
        'customerId',
        'totalCents',
        'currency',
      ]),
    );
  });
});
