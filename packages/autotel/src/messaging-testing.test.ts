import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMessagingTestHarness,
  createMockMessageBroker,
  createMockSpanContext,
  createMockProducerLink,
  createMockMessageBatch,
  createRebalanceScenario,
  createOutOfOrderScenario,
  createDuplicateScenario,
  extractTraceIdFromHeader,
  extractSpanIdFromHeader,
  type MessagingTestHarness,
  type MockMessageBroker,
} from './messaging-testing';

describe('Messaging Testing Utilities', () => {
  describe('createMessagingTestHarness', () => {
    let harness: MessagingTestHarness;

    beforeEach(() => {
      harness = createMessagingTestHarness();
      harness.reset();
    });

    describe('recordProducerCall', () => {
      it('should record producer calls', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: { orderId: '123' },
          headers: { traceparent: '00-abc-def-01' },
        });

        expect(harness.producerCalls).toHaveLength(1);
        expect(harness.producerCalls[0]?.destination).toBe('orders');
      });

      it('should add timestamp automatically', () => {
        const before = Date.now();
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: {},
        });
        const after = Date.now();

        const call = harness.producerCalls[0];
        expect(call?.timestamp).toBeGreaterThanOrEqual(before);
        expect(call?.timestamp).toBeLessThanOrEqual(after);
      });
    });

    describe('recordConsumerCall', () => {
      it('should record consumer calls', () => {
        harness.recordConsumerCall({
          destination: 'orders',
          system: 'kafka',
          consumerGroup: 'order-processor',
          payload: { orderId: '123' },
          producerLinks: [],
          isDuplicate: false,
          outOfOrderInfo: null,
        });

        expect(harness.consumerCalls).toHaveLength(1);
        expect(harness.consumerCalls[0]?.consumerGroup).toBe('order-processor');
      });
    });

    describe('createMockMessage', () => {
      it('should create mock message with defaults', () => {
        const msg = harness.createMockMessage({ orderId: '123' });

        expect(msg.payload).toEqual({ orderId: '123' });
        expect(msg.headers).toBeDefined();
        expect(msg.headers?.traceparent).toBeDefined();
        expect(msg.offset).toBeDefined();
        expect(msg.messageId).toBeDefined();
      });

      it('should allow custom options', () => {
        const msg = harness.createMockMessage(
          { orderId: '123' },
          { partition: 5, key: 'user-1' },
        );

        expect(msg.partition).toBe(5);
        expect(msg.key).toBe('user-1');
      });
    });

    describe('createMockTraceHeaders', () => {
      it('should create valid traceparent header', () => {
        const headers = harness.createMockTraceHeaders();

        expect(headers.traceparent).toMatch(
          /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/,
        );
      });

      it('should use provided trace and span IDs', () => {
        const headers = harness.createMockTraceHeaders(
          'a'.repeat(32),
          'b'.repeat(16),
        );

        expect(headers.traceparent).toBe(
          `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        );
      });
    });

    describe('assertProducerCalled', () => {
      it('should pass when producer was called', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: { traceparent: '00-abc-def-01' },
        });

        expect(() => harness.assertProducerCalled('orders')).not.toThrow();
      });

      it('should fail when producer was not called', () => {
        expect(() => harness.assertProducerCalled('orders')).toThrow(
          /Expected producer to be called/,
        );
      });

      it('should check message count', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: {},
        });
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: {},
        });

        expect(() =>
          harness.assertProducerCalled('orders', { messageCount: 2 }),
        ).not.toThrow();

        expect(() =>
          harness.assertProducerCalled('orders', { messageCount: 3 }),
        ).toThrow(/Expected 3 producer calls/);
      });

      it('should check trace headers', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: { traceparent: '00-abc-def-01' },
        });

        expect(() =>
          harness.assertProducerCalled('orders', { hasTraceHeaders: true }),
        ).not.toThrow();
      });

      it('should fail when trace headers missing', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: {},
        });

        expect(() =>
          harness.assertProducerCalled('orders', { hasTraceHeaders: true }),
        ).toThrow(/to have trace headers/);
      });
    });

    describe('assertProducerNotCalled', () => {
      it('should pass when producer was not called', () => {
        expect(() => harness.assertProducerNotCalled('orders')).not.toThrow();
      });

      it('should fail when producer was called', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: {},
        });

        expect(() => harness.assertProducerNotCalled('orders')).toThrow(
          /Expected producer not to be called/,
        );
      });
    });

    describe('assertConsumerProcessed', () => {
      it('should pass when consumer processed messages', () => {
        harness.recordConsumerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          producerLinks: [],
          isDuplicate: false,
          outOfOrderInfo: null,
        });

        expect(() => harness.assertConsumerProcessed('orders')).not.toThrow();
      });

      it('should check for duplicates', () => {
        harness.recordConsumerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          producerLinks: [],
          isDuplicate: true,
          outOfOrderInfo: null,
        });

        expect(() =>
          harness.assertConsumerProcessed('orders', { hasDuplicates: true }),
        ).not.toThrow();

        expect(() =>
          harness.assertConsumerProcessed('orders', { hasDuplicates: false }),
        ).toThrow(/Expected no duplicate messages/);
      });
    });

    describe('getProducerCalls / getConsumerCalls', () => {
      it('should filter by destination', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: {},
        });
        harness.recordProducerCall({
          destination: 'events',
          system: 'kafka',
          payload: {},
          headers: {},
        });

        const orderCalls = harness.getProducerCalls('orders');
        expect(orderCalls).toHaveLength(1);
        expect(orderCalls[0]?.destination).toBe('orders');

        const allCalls = harness.getProducerCalls();
        expect(allCalls).toHaveLength(2);
      });
    });

    describe('getLastProducerCall / getLastConsumerCall', () => {
      it('should return the last call', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: { id: 1 },
          headers: {},
        });
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: { id: 2 },
          headers: {},
        });

        const lastCall = harness.getLastProducerCall('orders');
        expect(lastCall?.payload).toEqual({ id: 2 });
      });

      it('should return undefined when no calls', () => {
        expect(harness.getLastProducerCall('orders')).toBeUndefined();
      });
    });

    describe('reset', () => {
      it('should clear all recorded calls', () => {
        harness.recordProducerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          headers: {},
        });
        harness.recordConsumerCall({
          destination: 'orders',
          system: 'kafka',
          payload: {},
          producerLinks: [],
          isDuplicate: false,
          outOfOrderInfo: null,
        });

        harness.reset();

        expect(harness.producerCalls).toHaveLength(0);
        expect(harness.consumerCalls).toHaveLength(0);
        expect(harness.rebalanceEvents).toHaveLength(0);
      });
    });
  });

  describe('createMockMessageBroker', () => {
    let broker: MockMessageBroker;

    beforeEach(() => {
      broker = createMockMessageBroker();
      broker.clear();
    });

    describe('publish / consume', () => {
      it('should publish and consume messages', () => {
        broker.publish('orders', { payload: { id: 1 } });
        broker.publish('orders', { payload: { id: 2 } });

        const messages = broker.consume('orders');
        expect(messages).toHaveLength(2);
        expect(messages[0]?.payload).toEqual({ id: 1 });
        expect(messages[1]?.payload).toEqual({ id: 2 });
      });

      it('should consume specified count', () => {
        broker.publish('orders', { payload: { id: 1 } });
        broker.publish('orders', { payload: { id: 2 } });
        broker.publish('orders', { payload: { id: 3 } });

        const messages = broker.consume('orders', 2);
        expect(messages).toHaveLength(2);

        const remaining = broker.consume('orders');
        expect(remaining).toHaveLength(1);
      });

      it('should auto-assign offsets', () => {
        broker.publish('orders', { payload: { id: 1 } });
        broker.publish('orders', { payload: { id: 2 } });

        const messages = broker.peek('orders');
        expect(messages[0]?.offset).toBe(0);
        expect(messages[1]?.offset).toBe(1);
      });
    });

    describe('peek', () => {
      it('should peek without consuming', () => {
        broker.publish('orders', { payload: { id: 1 } });

        const peeked = broker.peek('orders');
        expect(peeked).toHaveLength(1);

        const consumed = broker.consume('orders');
        expect(consumed).toHaveLength(1);
      });
    });

    describe('getMessageCount', () => {
      it('should return correct count', () => {
        expect(broker.getMessageCount('orders')).toBe(0);

        broker.publish('orders', { payload: {} });
        broker.publish('orders', { payload: {} });

        expect(broker.getMessageCount('orders')).toBe(2);
      });
    });

    describe('topic management', () => {
      it('should create and delete topics', () => {
        broker.createTopic('orders');
        expect(broker.listTopics()).toContain('orders');

        broker.deleteTopic('orders');
        expect(broker.listTopics()).not.toContain('orders');
      });

      it('should clear specific topic', () => {
        broker.publish('orders', { payload: {} });
        broker.publish('events', { payload: {} });

        broker.clear('orders');

        expect(broker.getMessageCount('orders')).toBe(0);
        expect(broker.getMessageCount('events')).toBe(1);
      });

      it('should clear all topics', () => {
        broker.publish('orders', { payload: {} });
        broker.publish('events', { payload: {} });

        broker.clear();

        expect(broker.listTopics()).toHaveLength(0);
      });
    });
  });

  describe('Context Propagation Helpers', () => {
    describe('extractTraceIdFromHeader', () => {
      it('should extract trace ID from valid traceparent', () => {
        const traceId = extractTraceIdFromHeader(
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        );
        expect(traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      });

      it('should return null for invalid header', () => {
        expect(extractTraceIdFromHeader('invalid')).toBeNull();
        expect(extractTraceIdFromHeader('')).toBeNull();
      });
    });

    describe('extractSpanIdFromHeader', () => {
      it('should extract span ID from valid traceparent', () => {
        const spanId = extractSpanIdFromHeader(
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        );
        expect(spanId).toBe('00f067aa0ba902b7');
      });

      it('should return null for invalid header', () => {
        expect(extractSpanIdFromHeader('invalid')).toBeNull();
        expect(extractSpanIdFromHeader('00-abc')).toBeNull();
      });
    });

    describe('createMockSpanContext', () => {
      it('should create valid span context', () => {
        const ctx = createMockSpanContext();

        expect(ctx.traceId).toHaveLength(32);
        expect(ctx.spanId).toHaveLength(16);
        expect(ctx.traceFlags).toBe(1);
        expect(ctx.isRemote).toBe(true);
      });

      it('should use provided IDs', () => {
        const ctx = createMockSpanContext('a'.repeat(32), 'b'.repeat(16));

        expect(ctx.traceId).toBe('a'.repeat(32));
        expect(ctx.spanId).toBe('b'.repeat(16));
      });
    });

    describe('createMockProducerLink', () => {
      it('should create valid producer link', () => {
        const link = createMockProducerLink();

        expect(link.context.traceId).toHaveLength(32);
        expect(link.context.spanId).toHaveLength(16);
        expect(link.attributes?.['messaging.link.source']).toBe('producer');
      });
    });
  });

  describe('Scenario Builders', () => {
    describe('createMockMessageBatch', () => {
      it('should create batch with trace headers', () => {
        const batch = createMockMessageBatch([{ id: 1 }, { id: 2 }]);

        expect(batch).toHaveLength(2);
        expect(batch[0]?.headers?.traceparent).toBeDefined();
        expect(batch[1]?.headers?.traceparent).toBeDefined();
      });

      it('should use same trace ID for batch', () => {
        const batch = createMockMessageBatch([{ id: 1 }, { id: 2 }], {
          traceId: 'a'.repeat(32),
        });

        const traceId1 = extractTraceIdFromHeader(
          batch[0]?.headers?.traceparent ?? '',
        );
        const traceId2 = extractTraceIdFromHeader(
          batch[1]?.headers?.traceparent ?? '',
        );

        expect(traceId1).toBe('a'.repeat(32));
        expect(traceId2).toBe('a'.repeat(32));
      });

      it('should set sequential offsets', () => {
        const batch = createMockMessageBatch([{ id: 1 }, { id: 2 }], {
          startOffset: 100,
        });

        expect(batch[0]?.offset).toBe(100);
        expect(batch[1]?.offset).toBe(101);
      });

      it('should skip trace headers when disabled', () => {
        const batch = createMockMessageBatch([{ id: 1 }], {
          addTraceHeaders: false,
        });

        expect(batch[0]?.headers).toBeUndefined();
      });
    });

    describe('createRebalanceScenario', () => {
      it('should create assign and revoke events', () => {
        const scenario = createRebalanceScenario(
          'orders',
          'processors',
          [0, 1, 2],
        );

        expect(scenario.assignEvent.type).toBe('assigned');
        expect(scenario.assignEvent.partitions).toHaveLength(3);
        expect(scenario.assignEvent.destination).toBe('orders');
        expect(scenario.assignEvent.consumerGroup).toBe('processors');

        expect(scenario.revokeEvent.type).toBe('revoked');
        expect(scenario.revokeEvent.partitions).toHaveLength(3);
      });

      it('should have incrementing generations', () => {
        const scenario = createRebalanceScenario('orders', 'processors', [0]);

        expect(scenario.assignEvent.generation).toBe(1);
        expect(scenario.revokeEvent.generation).toBe(2);
      });
    });

    describe('createOutOfOrderScenario', () => {
      it('should create out-of-order messages', () => {
        const messages = createOutOfOrderScenario(
          [{ id: 1 }, { id: 2 }, { id: 3 }],
          [2], // Swap index 2 with index 1
        );

        // Original order: 0, 1, 2
        // After swap at index 2: 0, 2, 1
        expect(messages[0]?.payload).toEqual({ id: 1 });
        expect(messages[1]?.payload).toEqual({ id: 3 }); // Swapped
        expect(messages[2]?.payload).toEqual({ id: 2 }); // Swapped
      });
    });

    describe('createDuplicateScenario', () => {
      it('should create duplicate messages', () => {
        const messages = createDuplicateScenario(
          [{ id: 1 }, { id: 2 }],
          [0], // Duplicate first message
        );

        expect(messages).toHaveLength(3);
        expect(messages[0]?.payload).toEqual({ id: 1 });
        expect(messages[1]?.payload).toEqual({ id: 1 }); // Duplicate
        expect(messages[2]?.payload).toEqual({ id: 2 });
      });

      it('should handle multiple duplicates', () => {
        const messages = createDuplicateScenario(
          [{ id: 1 }, { id: 2 }, { id: 3 }],
          [0, 2],
        );

        // After duplicating index 0 and 2:
        // Original: [1, 2, 3]
        // After dup 0: [1, 1-dup, 2, 3]
        // After dup 2: [1, 1-dup, 2, 3, 3-dup] (original index 2 = {id:3})
        expect(messages.length).toBeGreaterThan(3);
      });
    });
  });
});
