import { defineEvent } from 'autotel';
import { z } from 'zod';

const lineItemSchema = z.object({
  sku: z.string(),
  quantity: z.number(),
  priceCents: z.number(),
});

export const orderPlacedEvent = defineEvent(
  'order.placed',
  z.object({
    orderId: z.string(),
    customerId: z.string(),
    totalCents: z.number(),
    currency: z.string(),
    items: z.array(lineItemSchema),
    shipping: z.object({ addressId: z.string() }),
    metadata: z.object({ source: z.string() }),
    _autotel: z.object({
      channel: z.string(),
      producer: z.string(),
      consumers: z.array(z.string()).optional(),
    }),
  }),
  { toJsonSchema: (schema) => z.toJSONSchema(schema) },
);

export const paymentCapturedEvent = defineEvent(
  'payment.captured',
  z.object({
    orderId: z.string(),
    amountCents: z.number(),
    currency: z.string(),
    psp: z.string(),
    pspTransactionId: z.string(),
    capturedAt: z.string(),
    _autotel: z.object({
      channel: z.string(),
      producer: z.string(),
      consumers: z.array(z.string()).optional(),
    }),
  }),
  { toJsonSchema: (schema) => z.toJSONSchema(schema) },
);

export const paymentFailedEvent = defineEvent(
  'payment.failed',
  z.object({
    orderId: z.string(),
    declineCode: z.string(),
    attempts: z.number(),
    psp: z.string(),
    failedAt: z.string(),
    _autotel: z.object({
      channel: z.string(),
      producer: z.string(),
      consumers: z.array(z.string()).optional(),
    }),
  }),
  { toJsonSchema: (schema) => z.toJSONSchema(schema) },
);

const recommendationSchema = z.object({
  sku: z.string(),
  score: z.number(),
  reason: z.string(),
});

const inventoryItemSchema = z.object({
  sku: z.string(),
  quantity: z.number(),
  priceCents: z.number(),
});

export const inventoryReservedEvent = defineEvent(
  'inventory.reserved',
  z.object({
    orderId: z.string(),
    reservationId: z.string(),
    warehouseId: z.string(),
    items: z.array(inventoryItemSchema),
    reservedAt: z.string(),
    _autotel: z.object({
      channel: z.string(),
      producer: z.string(),
      consumers: z.array(z.string()).optional(),
    }),
  }),
  { toJsonSchema: (schema) => z.toJSONSchema(schema) },
);

export const recommendationGeneratedEvent = defineEvent(
  'recommendation.generated',
  z.object({
    orderId: z.string(),
    recommendations: z.array(recommendationSchema),
    model: z.string(),
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
    }),
    personalization_seed: z.string(),
    _drift_demo_field: z.string().optional(),
    _autotel: z.object({ channel: z.string(), producer: z.string() }),
  }),
  { toJsonSchema: (schema) => z.toJSONSchema(schema) },
);
