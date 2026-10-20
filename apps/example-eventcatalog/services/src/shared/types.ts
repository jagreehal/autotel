// Shared types across the illustrative services. Mirror the JSON Schemas in
// the EventCatalog so the catalog and the code stay in lockstep.

export type OrderItem = {
  sku: string;
  quantity: number;
  priceCents: number;
};

export type PlaceOrderInput = {
  id: string;
  customerId: string;
  totalCents: number;
  currency: 'USD' | 'EUR' | 'GBP';
  items: OrderItem[];
  shipping?: { addressId: string };
  metadata?: { source: 'web' | 'mobile' | 'api' };
};

/** W3C trace context the producer puts on the wire, so consumers link back. */
export type MessageHeaders = Record<string, string>;

export type OrderPlacedMessage = PlaceOrderInput & {
  type: 'OrderPlaced';
  headers?: MessageHeaders;
};

export type PaymentCapturedMessage = {
  orderId: string;
  items: OrderItem[];
  headers?: MessageHeaders;
};
