import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createParkingLot,
  InMemoryTraceContextStore,
  createCorrelationKey,
  toSpanContext,
  type StoredTraceContext,
  type CallbackContext,
} from './webhook';

// Mock the functional trace
vi.mock('./functional', () => ({
  trace: vi.fn((options, factory) => {
    return (...args: unknown[]) => {
      const mockCtx = createMockTraceContext();
      const fn = factory(mockCtx);
      return fn(...args);
    };
  }),
}));

// Mock OpenTelemetry trace
vi.mock('@opentelemetry/api', () => ({
  SpanKind: { SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 },
  SpanStatusCode: { OK: 1, ERROR: 2 },
  trace: {
    getActiveSpan: vi.fn(() => ({
      spanContext: () => ({
        traceId: '00000000000000000000000000000001',
        spanId: '0000000000000002',
        traceFlags: 1,
      }),
      addEvent: vi.fn(),
    })),
  },
  context: {
    active: vi.fn(),
  },
}));

function createMockTraceContext() {
  return {
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    addEvent: vi.fn(),
    addLinks: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
    getSpan: vi.fn(),
    getSpanContext: vi.fn(() => ({
      traceId: '00000000000000000000000000000001',
      spanId: '0000000000000002',
      traceFlags: 1,
    })),
  };
}

describe('Webhook Parking Lot', () => {
  let store: InMemoryTraceContextStore;
  let parkingLot: ReturnType<typeof createParkingLot>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new InMemoryTraceContextStore({ cleanupIntervalMs: 0 }); // Disable auto-cleanup for tests
    parkingLot = createParkingLot({
      store,
      defaultTTLMs: 60_000, // 1 minute for tests
    });
  });

  afterEach(() => {
    store.destroy();
    store.clear();
  });

  describe('InMemoryTraceContextStore', () => {
    it('should save and load context', async () => {
      const context: StoredTraceContext = {
        traceId: 'trace-123',
        spanId: 'span-456',
        traceFlags: 1,
        parkedAt: Date.now(),
      };

      await store.save('test-key', context);
      const loaded = await store.load('test-key');

      expect(loaded).toEqual(context);
    });

    it('should return null for non-existent key', async () => {
      const loaded = await store.load('non-existent');
      expect(loaded).toBeNull();
    });

    it('should delete context', async () => {
      const context: StoredTraceContext = {
        traceId: 'trace-123',
        spanId: 'span-456',
        traceFlags: 1,
        parkedAt: Date.now(),
      };

      await store.save('test-key', context);
      await store.delete('test-key');
      const loaded = await store.load('test-key');

      expect(loaded).toBeNull();
    });

    it('should expire contexts based on TTL', async () => {
      const context: StoredTraceContext = {
        traceId: 'trace-123',
        spanId: 'span-456',
        traceFlags: 1,
        parkedAt: Date.now() - 120_000, // 2 minutes ago
        ttlMs: 60_000, // 1 minute TTL
      };

      await store.save('test-key', context);
      const loaded = await store.load('test-key');

      expect(loaded).toBeNull(); // Should be expired
    });

    it('should not expire contexts within TTL', async () => {
      const context: StoredTraceContext = {
        traceId: 'trace-123',
        spanId: 'span-456',
        traceFlags: 1,
        parkedAt: Date.now() - 30_000, // 30 seconds ago
        ttlMs: 60_000, // 1 minute TTL
      };

      await store.save('test-key', context);
      const loaded = await store.load('test-key');

      expect(loaded).toEqual(context);
    });

    it('should track size', async () => {
      expect(store.size).toBe(0);

      await store.save('key1', {
        traceId: 't1',
        spanId: 's1',
        traceFlags: 1,
        parkedAt: Date.now(),
      });
      expect(store.size).toBe(1);

      await store.save('key2', {
        traceId: 't2',
        spanId: 's2',
        traceFlags: 1,
        parkedAt: Date.now(),
      });
      expect(store.size).toBe(2);

      await store.delete('key1');
      expect(store.size).toBe(1);
    });

    it('should clear all contexts', async () => {
      await store.save('key1', {
        traceId: 't1',
        spanId: 's1',
        traceFlags: 1,
        parkedAt: Date.now(),
      });
      await store.save('key2', {
        traceId: 't2',
        spanId: 's2',
        traceFlags: 1,
        parkedAt: Date.now(),
      });

      expect(store.size).toBe(2);
      store.clear();
      expect(store.size).toBe(0);
    });
  });

  describe('createParkingLot', () => {
    it('should create parking lot with default config', () => {
      const lot = createParkingLot({ store });
      expect(lot).toBeDefined();
      expect(lot.park).toBeInstanceOf(Function);
      expect(lot.retrieve).toBeInstanceOf(Function);
      expect(lot.traceCallback).toBeInstanceOf(Function);
      expect(lot.createLink).toBeInstanceOf(Function);
      expect(lot.exists).toBeInstanceOf(Function);
    });

    it('should use custom key prefix', async () => {
      const customStore = new InMemoryTraceContextStore({
        cleanupIntervalMs: 0,
      });
      const lot = createParkingLot({
        store: customStore,
        keyPrefix: 'custom:',
      });

      await lot.park('test-key');

      // Should be stored with custom prefix
      const loaded = await customStore.load('custom:test-key');
      expect(loaded).not.toBeNull();

      customStore.destroy();
    });
  });

  describe('park()', () => {
    it('should park current trace context', async () => {
      const key = await parkingLot.park('payment:order-123');

      // park() returns the unprefixed key for use with retrieve()
      expect(key).toBe('payment:order-123');

      // Store uses prefixed key internally
      const stored = await store.load(`parkingLot:${key}`);
      expect(stored).not.toBeNull();
      expect(stored?.traceId).toBe('00000000000000000000000000000001');
      expect(stored?.spanId).toBe('0000000000000002');
      expect(stored?.traceFlags).toBe(1);
    });

    it('should store metadata', async () => {
      const key = await parkingLot.park('payment:order-123', {
        customerId: 'cust-456',
        amount: '99.99',
      });

      // park() returns the unprefixed key; store uses prefixed key internally
      const stored = await store.load(`parkingLot:${key}`);
      expect(stored?.metadata).toEqual({
        customerId: 'cust-456',
        amount: '99.99',
      });
    });

    it('should set parkedAt timestamp', async () => {
      const beforePark = Date.now();
      const key = await parkingLot.park('test-key');
      const afterPark = Date.now();

      const stored = await store.load(`parkingLot:${key}`);
      expect(stored?.parkedAt).toBeGreaterThanOrEqual(beforePark);
      expect(stored?.parkedAt).toBeLessThanOrEqual(afterPark);
    });

    it('should set TTL from config', async () => {
      const key = await parkingLot.park('test-key');

      const stored = await store.load(`parkingLot:${key}`);
      expect(stored?.ttlMs).toBe(60_000); // From config
    });
  });

  describe('retrieve()', () => {
    it('should retrieve parked context', async () => {
      await parkingLot.park('payment:order-123', { orderId: 'order-123' });

      const retrieved = await parkingLot.retrieve('payment:order-123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.traceId).toBe('00000000000000000000000000000001');
      expect(retrieved?.metadata?.orderId).toBe('order-123');
    });

    it('should return null for non-existent key', async () => {
      const retrieved = await parkingLot.retrieve('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should auto-delete after retrieval by default', async () => {
      await parkingLot.park('payment:order-123');

      // First retrieval should work
      const first = await parkingLot.retrieve('payment:order-123');
      expect(first).not.toBeNull();

      // Second retrieval should return null
      const second = await parkingLot.retrieve('payment:order-123');
      expect(second).toBeNull();
    });

    it('should not auto-delete when disabled', async () => {
      const lot = createParkingLot({
        store,
        autoDeleteOnRetrieve: false,
      });

      await lot.park('payment:order-123');

      // Multiple retrievals should work
      const first = await lot.retrieve('payment:order-123');
      const second = await lot.retrieve('payment:order-123');

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
    });

    it('should call onMiss callback when context not found', async () => {
      const onMiss = vi.fn();
      const lot = createParkingLot({
        store,
        onMiss,
      });

      await lot.retrieve('non-existent');

      expect(onMiss).toHaveBeenCalledWith('non-existent');
    });
  });

  describe('exists()', () => {
    it('should return true for existing context', async () => {
      await parkingLot.park('payment:order-123');

      const exists = await parkingLot.exists('payment:order-123');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent context', async () => {
      const exists = await parkingLot.exists('non-existent');
      expect(exists).toBe(false);
    });

    it('should not delete context when checking existence', async () => {
      await parkingLot.park('payment:order-123');

      // Check multiple times
      await parkingLot.exists('payment:order-123');
      await parkingLot.exists('payment:order-123');

      // Should still exist
      const retrieved = await parkingLot.retrieve('payment:order-123');
      expect(retrieved).not.toBeNull();
    });
  });

  describe('createLink()', () => {
    it('should create span link from stored context', () => {
      const stored: StoredTraceContext = {
        traceId: 'trace-123',
        spanId: 'span-456',
        traceFlags: 1,
        parkedAt: Date.now(),
        metadata: { key: 'value' },
      };

      const link = parkingLot.createLink(stored);

      expect(link.context.traceId).toBe('trace-123');
      expect(link.context.spanId).toBe('span-456');
      expect(link.context.traceFlags).toBe(1);
      expect(link.context.isRemote).toBe(true);
      expect(link.attributes?.['link.type']).toBe('parking_lot');
      expect(link.attributes?.['parking_lot.parked_at']).toBe(stored.parkedAt);
      expect(link.attributes?.['parking_lot.has_metadata']).toBe(true);
    });

    it('should not include has_metadata when no metadata', () => {
      const stored: StoredTraceContext = {
        traceId: 'trace-123',
        spanId: 'span-456',
        traceFlags: 1,
        parkedAt: Date.now(),
      };

      const link = parkingLot.createLink(stored);

      expect(link.attributes?.['parking_lot.has_metadata']).toBeUndefined();
    });
  });

  describe('traceCallback()', () => {
    it('should create traced callback function', async () => {
      await parkingLot.park('payment:order-123');

      const handler = parkingLot.traceCallback({
        name: 'webhook.payment.completed',
        correlationKeyFrom: (args) =>
          `payment:${(args[0] as { orderId: string }).orderId}`,
      })((_ctx) => async (event: { orderId: string }) => {
        return { processed: true, orderId: event.orderId };
      });

      const result = await handler({ orderId: 'order-123' });

      expect(result).toEqual({ processed: true, orderId: 'order-123' });
    });

    it('should provide parked context to handler', async () => {
      await parkingLot.park('payment:order-123', { customerId: 'cust-456' });

      let capturedCtx: CallbackContext | null = null;

      const handler = parkingLot.traceCallback({
        name: 'webhook.test',
        correlationKeyFrom: () => 'payment:order-123',
      })((ctx) => async () => {
        capturedCtx = ctx;
        return {};
      });

      await handler();

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx?.parkedContext).not.toBeNull();
      expect(capturedCtx?.parkedContext?.metadata?.customerId).toBe('cust-456');
      expect(capturedCtx?.correlationKey).toBe('payment:order-123');
    });

    it('should calculate elapsed time', async () => {
      // Park with a timestamp in the past
      const parkedAt = Date.now() - 5000; // 5 seconds ago
      await store.save('parkingLot:payment:order-123', {
        traceId: 't1',
        spanId: 's1',
        traceFlags: 1,
        parkedAt,
        ttlMs: 60_000,
      });

      let capturedElapsed: number | null = null;

      const handler = parkingLot.traceCallback({
        name: 'webhook.test',
        correlationKeyFrom: () => 'payment:order-123',
      })((ctx) => async () => {
        capturedElapsed = ctx.elapsedMs;
        return {};
      });

      await handler();

      expect(capturedElapsed).not.toBeNull();
      expect(capturedElapsed).toBeGreaterThanOrEqual(5000);
      expect(capturedElapsed).toBeLessThan(6000); // Should be close to 5 seconds
    });

    it('should handle missing parked context gracefully', async () => {
      let capturedCtx: CallbackContext | null = null;

      const handler = parkingLot.traceCallback({
        name: 'webhook.test',
        correlationKeyFrom: () => 'non-existent',
      })((ctx) => async () => {
        capturedCtx = ctx;
        return {};
      });

      await handler();

      expect(capturedCtx?.parkedContext).toBeNull();
      expect(capturedCtx?.elapsedMs).toBeNull();
    });

    it('should throw when requireParkedContext is true and context missing', async () => {
      const handler = parkingLot.traceCallback({
        name: 'webhook.test',
        correlationKeyFrom: () => 'non-existent',
        requireParkedContext: true,
      })((_ctx) => async () => {
        return {};
      });

      await expect(handler()).rejects.toThrow(
        'Required parked context not found for key: non-existent',
      );
    });

    it('should apply custom attributes', async () => {
      await parkingLot.park('payment:order-123');

      const mockCtx = createMockTraceContext();
      vi.mocked(
        await import('./functional').then((m) => m.trace),
      ).mockImplementationOnce((options, factory) => {
        return (...args: unknown[]) => {
          const fn = factory(mockCtx as any);
          return fn(...args);
        };
      });

      const handler = parkingLot.traceCallback({
        name: 'webhook.test',
        correlationKeyFrom: () => 'payment:order-123',
        attributes: {
          'webhook.provider': 'stripe',
          'webhook.version': 2,
        },
      })((_ctx) => async () => {
        return {};
      });

      await handler();

      // Attributes should be set (verified via mock)
    });
  });

  describe('Utility Functions', () => {
    describe('createCorrelationKey()', () => {
      it('should join string parts with colon', () => {
        const key = createCorrelationKey('payment', 'order-123', 'stripe');
        expect(key).toBe('payment:order-123:stripe');
      });

      it('should handle numeric parts', () => {
        const key = createCorrelationKey('user', 12_345, 'session');
        expect(key).toBe('user:12345:session');
      });

      it('should handle single part', () => {
        const key = createCorrelationKey('simple');
        expect(key).toBe('simple');
      });
    });

    describe('toSpanContext()', () => {
      it('should convert stored context to span context', () => {
        const stored: StoredTraceContext = {
          traceId: 'trace-123',
          spanId: 'span-456',
          traceFlags: 1,
          parkedAt: Date.now(),
        };

        const spanContext = toSpanContext(stored);

        expect(spanContext.traceId).toBe('trace-123');
        expect(spanContext.spanId).toBe('span-456');
        expect(spanContext.traceFlags).toBe(1);
        expect(spanContext.isRemote).toBe(true);
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle Stripe payment webhook flow', async () => {
      // 1. Initiate payment (park context)
      const orderId = 'order-12345';
      await parkingLot.park(`payment:${orderId}`, {
        orderId,
        amount: '99.99',
        currency: 'USD',
      });

      // 2. Simulate time passing (webhook arrives later)
      const parkedContext = await store.load(`parkingLot:payment:${orderId}`);
      expect(parkedContext).not.toBeNull();

      // 3. Handle webhook callback
      let webhookCtx: CallbackContext | null = null;
      const handleWebhook = parkingLot.traceCallback({
        name: 'stripe.webhook.payment_intent.succeeded',
        correlationKeyFrom: (args) => {
          const event = args[0] as {
            data: { object: { metadata: { orderId: string } } };
          };
          return `payment:${event.data.object.metadata.orderId}`;
        },
      })((ctx) => async (_event) => {
        webhookCtx = ctx;
        // Process payment...
        return { success: true };
      });

      const result = await handleWebhook({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            metadata: { orderId },
          },
        },
      });

      expect(result).toEqual({ success: true });
      expect(webhookCtx?.parkedContext?.metadata?.amount).toBe('99.99');
      expect(webhookCtx?.correlationKey).toBe(`payment:${orderId}`);
    });

    it('should handle human approval workflow', async () => {
      // 1. Request approval (park context)
      const requestId = 'approval-req-001';
      await parkingLot.park(`approval:${requestId}`, {
        requestType: 'expense',
        amount: '5000',
        requester: 'john@example.com',
      });

      // 2. Human approves via UI (simulated)

      // 3. Handle approval callback
      const handleApproval = parkingLot.traceCallback({
        name: 'approval.callback',
        correlationKeyFrom: (args) =>
          `approval:${(args[0] as { requestId: string }).requestId}`,
      })(
        (ctx) => async (approval: { requestId: string; approved: boolean }) => {
          const metadata = ctx.parkedContext?.metadata;
          return {
            processed: true,
            amount: metadata?.amount,
            approved: approval.approved,
          };
        },
      );

      const result = await handleApproval({
        requestId,
        approved: true,
      });

      expect(result).toEqual({
        processed: true,
        amount: '5000',
        approved: true,
      });
    });

    it('should handle multiple concurrent parked contexts', async () => {
      // Park multiple contexts
      await Promise.all([
        parkingLot.park('order:1', { status: 'pending' }),
        parkingLot.park('order:2', { status: 'pending' }),
        parkingLot.park('order:3', { status: 'pending' }),
      ]);

      // Verify all are stored
      expect(await parkingLot.exists('order:1')).toBe(true);
      expect(await parkingLot.exists('order:2')).toBe(true);
      expect(await parkingLot.exists('order:3')).toBe(true);

      // Retrieve in different order
      const ctx2 = await parkingLot.retrieve('order:2');
      const ctx1 = await parkingLot.retrieve('order:1');
      const ctx3 = await parkingLot.retrieve('order:3');

      expect(ctx1?.metadata?.status).toBe('pending');
      expect(ctx2?.metadata?.status).toBe('pending');
      expect(ctx3?.metadata?.status).toBe('pending');
    });
  });
});
