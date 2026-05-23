// InventoryService — reserves stock against a confirmed payment.

import { trace, span, track } from 'autotel';
import { traceConsumer } from 'autotel/messaging';

type ReserveItems = Array<{ sku: string; quantity: number }>;

const wms = {
  reserve: async (_items: ReserveItems) => ({
    id: 'rsv_' + Math.random().toString(36).slice(2, 10),
  }),
};

export const reserveStock = trace((ctx) => async (orderId: string, items: ReserveItems) => {
  ctx.setAttribute('inventory.order_id', orderId);
  ctx.setAttribute('inventory.item_count', items.length);

  const reservation = await span('wms.reserve', async (s) => {
    s.setAttribute('wms.system', 'manhattan');
    return wms.reserve(items);
  });

  track('inventory.reserved', {
    orderId,
    reservationId: reservation.id,
    warehouseId: 'wh-eu-1',
    items,
    reservedAt: new Date().toISOString(),
    _autotel: { channel: 'inventory.events', producer: 'InventoryService' },
  });

  return reservation;
});

export const handlePaymentCaptured = traceConsumer({
  system: 'kafka',
  destination: 'payments.events',
})(() => async (msg: { orderId: string; items: ReserveItems }) =>
  reserveStock(msg.orderId, msg.items),
);
