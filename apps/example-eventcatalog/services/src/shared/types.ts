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

export type OrderPlacedMessage = PlaceOrderInput & { type: 'OrderPlaced' };
