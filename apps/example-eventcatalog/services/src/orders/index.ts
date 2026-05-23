// OrdersService — accepts the order, persists it, emits OrderPlaced.
//
// The catalog page for this service (catalog/domains/E-Commerce/services/
// OrdersService/index.mdx) is the read-side of the instrumentation below.
// Field names, event names, and channel names match the catalog exactly.

import { trace, track } from 'autotel';
import { traceProducer } from 'autotel/messaging';
import type { PlaceOrderInput, OrderPlacedMessage } from '../shared/types';

const db = {
  orders: { insert: async (_order: PlaceOrderInput) => undefined },
};
const kafka = {
  publish: async (_topic: string, _msg: OrderPlacedMessage) => undefined,
};

const publishOrderPlaced = traceProducer({
  system: 'kafka',
  destination: 'orders.events',
})(() => async (msg: OrderPlacedMessage) => kafka.publish('orders.events', msg));

export const placeOrder = trace((ctx) => async (order: PlaceOrderInput) => {
  ctx.setAttribute('order.customer_id', order.customerId);
  ctx.setAttribute('order.value_cents', order.totalCents);
  ctx.setAttribute('order.item_count', order.items.length);

  await db.orders.insert(order);
  await publishOrderPlaced({ type: 'OrderPlaced', ...order });

  track('order.placed', {
    orderId: order.id,
    customerId: order.customerId,
    totalCents: order.totalCents,
    currency: order.currency,
    items: order.items,
    shipping: order.shipping,
    metadata: order.metadata,
    _autotel: { channel: 'orders.events', producer: 'OrdersService' },
  });

  return order;
});
