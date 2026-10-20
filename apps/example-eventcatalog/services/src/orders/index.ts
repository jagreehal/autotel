// OrdersService — accepts the order, persists it, emits OrderPlaced.
//
// The catalog page for this service (catalog/domains/E-Commerce/services/
// OrdersService/index.mdx) is the read-side of the instrumentation below.
// Field names, event names, and channel names match the catalog exactly.

import { withTracing } from 'autotel';
import { traceProducer } from 'autotel/messaging';
import type { PlaceOrderInput, OrderPlacedMessage } from '../shared/types';
import { orderPlacedEvent } from '../shared/events';

const db = {
  orders: { insert: async (_order: PlaceOrderInput) => undefined },
};
const kafka = {
  publish: async (_topic: string, _msg: OrderPlacedMessage) => undefined,
};

// The headers carry this span's context, so each consumer's span links back to
// it. `order.placed` is tracked inside the same span: one producer span is one
// message, which is how the snapshot knows which event a consumer received.
const publishOrderPlaced = traceProducer({
  system: 'kafka',
  destination: 'orders.events',
})((ctx) => async (msg: OrderPlacedMessage) => {
  const sent = { ...msg, headers: ctx.getAllPropagationHeaders() };
  await kafka.publish('orders.events', sent);
  orderPlacedEvent.track({
    orderId: msg.id,
    customerId: msg.customerId,
    totalCents: msg.totalCents,
    currency: msg.currency,
    items: msg.items,
    shipping: msg.shipping,
    metadata: msg.metadata,
    _autotel: {
      channel: 'orders.events',
      producer: 'OrdersService',
      consumers: ['PaymentService', 'RecommendationsService'],
    },
  });
  return sent;
});

export const placeOrder = withTracing({})(
  (ctx) => async (order: PlaceOrderInput) => {
    ctx.setAttribute('order.customer_id', order.customerId);
    ctx.setAttribute('order.value_cents', order.totalCents);
    ctx.setAttribute('order.item_count', order.items.length);

    await db.orders.insert(order);
    return publishOrderPlaced({ type: 'OrderPlaced', ...order });
  },
);
