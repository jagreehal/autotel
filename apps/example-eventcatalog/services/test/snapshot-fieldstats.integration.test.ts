import { describe, it, expect } from 'vitest';
import { init } from 'autotel';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';
import { placeOrder } from '../src/orders/index';
import { handleOrderPlaced } from '../src/payments/index';
import { handlePaymentCaptured } from '../src/inventory/index';
import { generateRecommendation } from '../src/recommendations/index';
import type { PlaceOrderInput, OrderPlacedMessage } from '../src/shared/types';

describe('snapshot integration — fieldStats', () => {
  it('captures per-path runtime types and sample values for tracked events', async () => {
    const snapshot = new ArchitectureSnapshotSubscriber({
      service: 'example-eventcatalog',
    });

    init({
      service: 'example-eventcatalog',
      subscribers: [snapshot],
    });

    const order: PlaceOrderInput = {
      id: 'order-fieldstats-1',
      customerId: 'customer-fieldstats-1',
      totalCents: 9999,
      currency: 'GBP',
      items: [{ sku: 'sku-1', quantity: 1, priceCents: 9999 }],
      shipping: { addressId: 'addr-1' },
      metadata: { source: 'web' },
    };

    await placeOrder(order);
    const msg: OrderPlacedMessage = { type: 'OrderPlaced', ...order };
    await Promise.all([handleOrderPlaced(msg), generateRecommendation(msg)]);
    await handlePaymentCaptured({ orderId: order.id, items: order.items });

    const snap = snapshot.toSnapshot();
    const orderPlaced = snap.events['order.placed'];
    expect(orderPlaced).toBeDefined();
    expect(orderPlaced.fieldStats).toBeDefined();
    expect(orderPlaced.fieldStats?.orderId?.types).toContain('string');
    expect(orderPlaced.fieldStats?.totalCents?.types).toContain('number');
    expect(orderPlaced.fieldStats?.metadata?.types).toContain('object');
    expect(orderPlaced.fieldStats?.currency?.sampleValues).toContain('GBP');
  });
});

