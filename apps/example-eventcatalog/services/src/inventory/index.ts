// InventoryService — reserves stock against a confirmed payment.

import { trace, span } from 'autotel';
import { traceConsumer } from 'autotel/messaging';
import { inventoryReservedEvent } from '../shared/events';
import { isoNow } from '../shared/clock';

type ReserveItems = Array<{ sku: string; quantity: number; priceCents: number }>;

type WmsStub = {
  reserve: (items: ReserveItems) => Promise<{ id: string }>;
};

let wms: WmsStub = {
  reserve: async (_items) => ({
    id: 'rsv_' + Math.random().toString(36).slice(2, 10),
  }),
};

/** Used by demos and tests that want deterministic reservation IDs. */
export function setWmsStub(next: WmsStub): void {
  wms = next;
}

export const reserveStock = trace((ctx) => async (orderId: string, items: ReserveItems) => {
  ctx.setAttribute('inventory.order_id', orderId);
  ctx.setAttribute('inventory.item_count', items.length);

  const reservation = await span('wms.reserve', async (s) => {
    s.setAttribute('wms.system', 'manhattan');
    return wms.reserve(items);
  });

  inventoryReservedEvent.track({
    orderId,
    reservationId: reservation.id,
    warehouseId: 'wh-eu-1',
    items,
    reservedAt: isoNow(),
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
