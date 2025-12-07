/**
 * Testing utilities for messaging instrumentation
 *
 * Provides mock producers, consumers, and assertion helpers
 * for testing event-driven code with Autotel's messaging module.
 *
 * @example Basic test setup
 * ```typescript
 * import { createMessagingTestHarness } from 'autotel/messaging-testing';
 *
 * describe('Order processing', () => {
 *   const harness = createMessagingTestHarness();
 *
 *   beforeEach(() => harness.reset());
 *   afterAll(() => harness.shutdown());
 *
 *   it('should process order and publish event', async () => {
 *     await processOrder({ id: 'order-123' });
 *
 *     harness.assertProducerCalled('orders', {
 *       messageCount: 1,
 *       hasTraceHeaders: true,
 *     });
 *   });
 * });
 * ```
 *
 * @module
 */

import type { Link, SpanContext } from '@opentelemetry/api';
import type {
  RebalanceEvent,
  PartitionAssignment,
  OutOfOrderInfo,
} from './messaging';

// ============================================================================
// Types
// ============================================================================

/**
 * Recorded producer call
 */
export interface RecordedProducerCall {
  /** Destination (topic/queue) */
  destination: string;

  /** System (kafka, sqs, etc.) */
  system: string;

  /** Message payload */
  payload: unknown;

  /** Headers injected */
  headers: Record<string, string>;

  /** Timestamp of call */
  timestamp: number;

  /** Trace ID from headers */
  traceId?: string;

  /** Span ID from headers */
  spanId?: string;
}

/**
 * Recorded consumer call
 */
export interface RecordedConsumerCall {
  /** Destination (topic/queue) */
  destination: string;

  /** System (kafka, sqs, etc.) */
  system: string;

  /** Consumer group */
  consumerGroup?: string;

  /** Message payload */
  payload: unknown;

  /** Headers extracted */
  headers?: Record<string, string>;

  /** Timestamp of call */
  timestamp: number;

  /** Producer links extracted */
  producerLinks: Link[];

  /** Whether message was duplicate */
  isDuplicate: boolean;

  /** Out of order info if detected */
  outOfOrderInfo: OutOfOrderInfo | null;

  /** DLQ reason if routed to DLQ */
  dlqReason?: string;

  /** Retry attempt number */
  retryAttempt?: number;
}

/**
 * Recorded rebalance event
 */
export interface RecordedRebalanceEvent extends RebalanceEvent {
  /** Destination (topic) */
  destination: string;

  /** Consumer group */
  consumerGroup: string;
}

/**
 * Mock message for testing
 */
export interface MockMessage<T = unknown> {
  /** Message payload */
  payload: T;

  /** Headers */
  headers?: Record<string, string>;

  /** Offset/sequence number */
  offset?: number;

  /** Partition */
  partition?: number;

  /** Key */
  key?: string;

  /** Message ID */
  messageId?: string;

  /** Timestamp */
  timestamp?: number;
}

/**
 * Producer assertion options
 */
export interface ProducerAssertionOptions {
  /** Expected number of messages */
  messageCount?: number;

  /** Whether trace headers should be present */
  hasTraceHeaders?: boolean;

  /** Expected destination */
  destination?: string;

  /** Custom matcher for payload */
  payloadMatcher?: (payload: unknown) => boolean;

  /** Expected trace ID */
  traceId?: string;
}

/**
 * Consumer assertion options
 */
export interface ConsumerAssertionOptions {
  /** Expected number of messages processed */
  messageCount?: number;

  /** Whether producer links should be present */
  hasProducerLinks?: boolean;

  /** Expected destination */
  destination?: string;

  /** Expected consumer group */
  consumerGroup?: string;

  /** Whether any messages were duplicates */
  hasDuplicates?: boolean;

  /** Whether any messages were out of order */
  hasOutOfOrder?: boolean;

  /** Whether any messages went to DLQ */
  hasDLQ?: boolean;
}

/**
 * Messaging test harness
 */
export interface MessagingTestHarness {
  /** All recorded producer calls */
  producerCalls: RecordedProducerCall[];

  /** All recorded consumer calls */
  consumerCalls: RecordedConsumerCall[];

  /** All recorded rebalance events */
  rebalanceEvents: RecordedRebalanceEvent[];

  /**
   * Record a producer call
   */
  recordProducerCall(call: Omit<RecordedProducerCall, 'timestamp'>): void;

  /**
   * Record a consumer call
   */
  recordConsumerCall(call: Omit<RecordedConsumerCall, 'timestamp'>): void;

  /**
   * Record a rebalance event
   */
  recordRebalanceEvent(event: RecordedRebalanceEvent): void;

  /**
   * Create a mock message with trace headers
   */
  createMockMessage<T>(
    payload: T,
    options?: Partial<MockMessage<T>>,
  ): MockMessage<T>;

  /**
   * Create mock trace headers
   */
  createMockTraceHeaders(
    traceId?: string,
    spanId?: string,
  ): Record<string, string>;

  /**
   * Assert producer was called with expected options
   */
  assertProducerCalled(
    destination: string,
    options?: ProducerAssertionOptions,
  ): void;

  /**
   * Assert producer was not called
   */
  assertProducerNotCalled(destination?: string): void;

  /**
   * Assert consumer processed messages with expected options
   */
  assertConsumerProcessed(
    destination: string,
    options?: ConsumerAssertionOptions,
  ): void;

  /**
   * Assert consumer was not called
   */
  assertConsumerNotCalled(destination?: string): void;

  /**
   * Assert rebalance occurred
   */
  assertRebalanceOccurred(
    destination: string,
    type: RebalanceEvent['type'],
    partitionCount?: number,
  ): void;

  /**
   * Get producer calls for destination
   */
  getProducerCalls(destination?: string): RecordedProducerCall[];

  /**
   * Get consumer calls for destination
   */
  getConsumerCalls(destination?: string): RecordedConsumerCall[];

  /**
   * Get the last producer call
   */
  getLastProducerCall(destination?: string): RecordedProducerCall | undefined;

  /**
   * Get the last consumer call
   */
  getLastConsumerCall(destination?: string): RecordedConsumerCall | undefined;

  /**
   * Reset all recorded calls
   */
  reset(): void;

  /**
   * Shutdown the harness
   */
  shutdown(): void;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Generate a random hex string
 */
function randomHex(length: number): string {
  let result = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a messaging test harness
 *
 * Provides utilities for recording and asserting on producer/consumer calls
 * during testing.
 *
 * @example
 * ```typescript
 * const harness = createMessagingTestHarness();
 *
 * // In your test setup
 * beforeEach(() => harness.reset());
 *
 * // In your tests
 * it('should publish order event', async () => {
 *   await orderService.createOrder({ id: '123' });
 *
 *   harness.assertProducerCalled('orders', {
 *     messageCount: 1,
 *     hasTraceHeaders: true,
 *   });
 *
 *   const lastCall = harness.getLastProducerCall('orders');
 *   expect(lastCall?.payload).toMatchObject({ orderId: '123' });
 * });
 * ```
 */
export function createMessagingTestHarness(): MessagingTestHarness {
  const producerCalls: RecordedProducerCall[] = [];
  const consumerCalls: RecordedConsumerCall[] = [];
  const rebalanceEvents: RecordedRebalanceEvent[] = [];

  return {
    producerCalls,
    consumerCalls,
    rebalanceEvents,

    recordProducerCall(call) {
      producerCalls.push({
        ...call,
        timestamp: Date.now(),
      });
    },

    recordConsumerCall(call) {
      consumerCalls.push({
        ...call,
        timestamp: Date.now(),
      });
    },

    recordRebalanceEvent(event) {
      rebalanceEvents.push(event);
    },

    createMockMessage<T>(
      payload: T,
      options: Partial<MockMessage<T>> = {},
    ): MockMessage<T> {
      return {
        payload,
        headers: options.headers ?? this.createMockTraceHeaders(),
        offset: options.offset ?? Math.floor(Math.random() * 10_000),
        partition: options.partition ?? 0,
        key: options.key,
        messageId: options.messageId ?? `msg-${randomHex(8)}`,
        timestamp: options.timestamp ?? Date.now(),
      };
    },

    createMockTraceHeaders(
      traceId?: string,
      spanId?: string,
    ): Record<string, string> {
      const tid = traceId ?? randomHex(32);
      const sid = spanId ?? randomHex(16);
      return {
        traceparent: `00-${tid}-${sid}-01`,
      };
    },

    assertProducerCalled(
      destination: string,
      options: ProducerAssertionOptions = {},
    ) {
      const calls = producerCalls.filter((c) => c.destination === destination);

      if (calls.length === 0) {
        throw new Error(
          `Expected producer to be called for destination '${destination}', but it was not called`,
        );
      }

      if (
        options.messageCount !== undefined &&
        calls.length !== options.messageCount
      ) {
        throw new Error(
          `Expected ${options.messageCount} producer calls for '${destination}', got ${calls.length}`,
        );
      }

      if (options.hasTraceHeaders) {
        const withoutHeaders = calls.filter((c) => !c.headers?.traceparent);
        if (withoutHeaders.length > 0) {
          throw new Error(
            `Expected all producer calls for '${destination}' to have trace headers, but ${withoutHeaders.length} did not`,
          );
        }
      }

      if (options.traceId) {
        const matchingTraceId = calls.filter(
          (c) => c.traceId === options.traceId,
        );
        if (matchingTraceId.length === 0) {
          throw new Error(
            `Expected producer call for '${destination}' with traceId '${options.traceId}', but none found`,
          );
        }
      }

      if (options.payloadMatcher) {
        const matching = calls.filter((c) =>
          options.payloadMatcher!(c.payload),
        );
        if (matching.length === 0) {
          throw new Error(
            `Expected producer call for '${destination}' to match payload matcher, but none did`,
          );
        }
      }
    },

    assertProducerNotCalled(destination?: string) {
      if (destination) {
        const calls = producerCalls.filter(
          (c) => c.destination === destination,
        );
        if (calls.length > 0) {
          throw new Error(
            `Expected producer not to be called for '${destination}', but it was called ${calls.length} times`,
          );
        }
      } else {
        if (producerCalls.length > 0) {
          throw new Error(
            `Expected no producer calls, but ${producerCalls.length} calls were made`,
          );
        }
      }
    },

    assertConsumerProcessed(
      destination: string,
      options: ConsumerAssertionOptions = {},
    ) {
      const calls = consumerCalls.filter((c) => c.destination === destination);

      if (calls.length === 0) {
        throw new Error(
          `Expected consumer to process messages for destination '${destination}', but none were processed`,
        );
      }

      if (
        options.messageCount !== undefined &&
        calls.length !== options.messageCount
      ) {
        throw new Error(
          `Expected ${options.messageCount} consumer calls for '${destination}', got ${calls.length}`,
        );
      }

      if (options.consumerGroup) {
        const wrongGroup = calls.filter(
          (c) => c.consumerGroup !== options.consumerGroup,
        );
        if (wrongGroup.length > 0) {
          throw new Error(
            `Expected consumer group '${options.consumerGroup}' for '${destination}', but found different groups`,
          );
        }
      }

      if (options.hasProducerLinks) {
        const withoutLinks = calls.filter((c) => c.producerLinks.length === 0);
        if (withoutLinks.length > 0) {
          throw new Error(
            `Expected all consumer calls for '${destination}' to have producer links, but ${withoutLinks.length} did not`,
          );
        }
      }

      if (options.hasDuplicates !== undefined) {
        const duplicates = calls.filter((c) => c.isDuplicate);
        if (options.hasDuplicates && duplicates.length === 0) {
          throw new Error(
            `Expected duplicate messages for '${destination}', but none were detected`,
          );
        }
        if (!options.hasDuplicates && duplicates.length > 0) {
          throw new Error(
            `Expected no duplicate messages for '${destination}', but ${duplicates.length} were detected`,
          );
        }
      }

      if (options.hasOutOfOrder !== undefined) {
        const outOfOrder = calls.filter((c) => c.outOfOrderInfo !== null);
        if (options.hasOutOfOrder && outOfOrder.length === 0) {
          throw new Error(
            `Expected out-of-order messages for '${destination}', but none were detected`,
          );
        }
        if (!options.hasOutOfOrder && outOfOrder.length > 0) {
          throw new Error(
            `Expected no out-of-order messages for '${destination}', but ${outOfOrder.length} were detected`,
          );
        }
      }

      if (options.hasDLQ !== undefined) {
        const dlqCalls = calls.filter((c) => c.dlqReason !== undefined);
        if (options.hasDLQ && dlqCalls.length === 0) {
          throw new Error(
            `Expected DLQ routing for '${destination}', but none occurred`,
          );
        }
        if (!options.hasDLQ && dlqCalls.length > 0) {
          throw new Error(
            `Expected no DLQ routing for '${destination}', but ${dlqCalls.length} occurred`,
          );
        }
      }
    },

    assertConsumerNotCalled(destination?: string) {
      if (destination) {
        const calls = consumerCalls.filter(
          (c) => c.destination === destination,
        );
        if (calls.length > 0) {
          throw new Error(
            `Expected consumer not to be called for '${destination}', but it processed ${calls.length} messages`,
          );
        }
      } else {
        if (consumerCalls.length > 0) {
          throw new Error(
            `Expected no consumer calls, but ${consumerCalls.length} messages were processed`,
          );
        }
      }
    },

    assertRebalanceOccurred(
      destination: string,
      type: RebalanceEvent['type'],
      partitionCount?: number,
    ) {
      const events = rebalanceEvents.filter(
        (e) => e.destination === destination && e.type === type,
      );

      if (events.length === 0) {
        throw new Error(
          `Expected rebalance '${type}' for '${destination}', but none occurred`,
        );
      }

      if (partitionCount !== undefined) {
        const matching = events.filter(
          (e) => e.partitions.length === partitionCount,
        );
        if (matching.length === 0) {
          throw new Error(
            `Expected rebalance '${type}' for '${destination}' with ${partitionCount} partitions, but none matched`,
          );
        }
      }
    },

    getProducerCalls(destination?: string) {
      if (destination) {
        return producerCalls.filter((c) => c.destination === destination);
      }
      return [...producerCalls];
    },

    getConsumerCalls(destination?: string) {
      if (destination) {
        return consumerCalls.filter((c) => c.destination === destination);
      }
      return [...consumerCalls];
    },

    getLastProducerCall(destination?: string) {
      const calls = this.getProducerCalls(destination);
      return calls.at(-1);
    },

    getLastConsumerCall(destination?: string) {
      const calls = this.getConsumerCalls(destination);
      return calls.at(-1);
    },

    reset() {
      producerCalls.length = 0;
      consumerCalls.length = 0;
      rebalanceEvents.length = 0;
    },

    shutdown() {
      this.reset();
    },
  };
}

// ============================================================================
// Mock Broker
// ============================================================================

/**
 * Mock message broker for testing
 */
export interface MockMessageBroker {
  /** Topics/queues in the broker */
  topics: Map<string, MockMessage[]>;

  /**
   * Publish a message to a topic
   */
  publish(topic: string, message: MockMessage): void;

  /**
   * Consume messages from a topic
   */
  consume(topic: string, count?: number): MockMessage[];

  /**
   * Peek at messages without consuming
   */
  peek(topic: string, count?: number): MockMessage[];

  /**
   * Get message count for topic
   */
  getMessageCount(topic: string): number;

  /**
   * Clear all messages
   */
  clear(topic?: string): void;

  /**
   * Create a topic
   */
  createTopic(topic: string): void;

  /**
   * Delete a topic
   */
  deleteTopic(topic: string): void;

  /**
   * List all topics
   */
  listTopics(): string[];
}

/**
 * Create a mock message broker for testing
 *
 * Simulates a message broker (Kafka, SQS, RabbitMQ, etc.) for unit testing.
 *
 * @example
 * ```typescript
 * const broker = createMockMessageBroker();
 *
 * // Producer publishes
 * broker.publish('orders', { payload: { orderId: '123' }, headers: {} });
 *
 * // Consumer receives
 * const messages = broker.consume('orders');
 * expect(messages).toHaveLength(1);
 * expect(messages[0].payload).toEqual({ orderId: '123' });
 * ```
 */
export function createMockMessageBroker(): MockMessageBroker {
  const topics = new Map<string, MockMessage[]>();

  return {
    topics,

    publish(topic: string, message: MockMessage) {
      if (!topics.has(topic)) {
        topics.set(topic, []);
      }
      topics.get(topic)!.push({
        ...message,
        timestamp: message.timestamp ?? Date.now(),
        offset: message.offset ?? topics.get(topic)!.length,
      });
    },

    consume(topic: string, count?: number) {
      const messages = topics.get(topic) ?? [];
      if (count === undefined) {
        const all = [...messages];
        messages.length = 0;
        return all;
      }
      return messages.splice(0, count);
    },

    peek(topic: string, count?: number) {
      const messages = topics.get(topic) ?? [];
      if (count === undefined) {
        return [...messages];
      }
      return messages.slice(0, count);
    },

    getMessageCount(topic: string) {
      return topics.get(topic)?.length ?? 0;
    },

    clear(topic?: string) {
      if (topic) {
        topics.set(topic, []);
      } else {
        topics.clear();
      }
    },

    createTopic(topic: string) {
      if (!topics.has(topic)) {
        topics.set(topic, []);
      }
    },

    deleteTopic(topic: string) {
      topics.delete(topic);
    },

    listTopics() {
      return [...topics.keys()];
    },
  };
}

// ============================================================================
// Context Propagation Helpers
// ============================================================================

/**
 * Extract trace ID from traceparent header
 */
export function extractTraceIdFromHeader(traceparent: string): string | null {
  const parts = traceparent.split('-');
  if (parts.length >= 3 && parts[1] !== undefined) {
    return parts[1];
  }
  return null;
}

/**
 * Extract span ID from traceparent header
 */
export function extractSpanIdFromHeader(traceparent: string): string | null {
  const parts = traceparent.split('-');
  if (parts.length >= 4 && parts[2] !== undefined) {
    return parts[2];
  }
  return null;
}

/**
 * Create a mock span context
 */
export function createMockSpanContext(
  traceId?: string,
  spanId?: string,
): SpanContext {
  return {
    traceId: traceId ?? randomHex(32),
    spanId: spanId ?? randomHex(16),
    traceFlags: 1,
    isRemote: true,
  };
}

/**
 * Create a mock link to a producer span
 */
export function createMockProducerLink(
  traceId?: string,
  spanId?: string,
): Link {
  return {
    context: createMockSpanContext(traceId, spanId),
    attributes: {
      'messaging.link.source': 'producer',
    },
  };
}

// ============================================================================
// Scenario Builders
// ============================================================================

/**
 * Create a batch of mock messages
 */
export function createMockMessageBatch<T>(
  payloads: T[],
  options: {
    startOffset?: number;
    partition?: number;
    addTraceHeaders?: boolean;
    traceId?: string;
  } = {},
): MockMessage<T>[] {
  const startOffset = options.startOffset ?? 0;
  const addTraceHeaders = options.addTraceHeaders ?? true;
  const traceId = options.traceId ?? randomHex(32);

  return payloads.map((payload, index) => ({
    payload,
    headers: addTraceHeaders
      ? { traceparent: `00-${traceId}-${randomHex(16)}-01` }
      : undefined,
    offset: startOffset + index,
    partition: options.partition ?? 0,
    messageId: `msg-${randomHex(8)}`,
    timestamp: Date.now() + index,
  }));
}

/**
 * Create a rebalance scenario
 */
export function createRebalanceScenario(
  topic: string,
  consumerGroup: string,
  partitions: number[],
): {
  assignEvent: RecordedRebalanceEvent;
  revokeEvent: RecordedRebalanceEvent;
} {
  const assignments: PartitionAssignment[] = partitions.map((p) => ({
    topic,
    partition: p,
    offset: 0,
  }));

  return {
    assignEvent: {
      type: 'assigned',
      partitions: assignments,
      timestamp: Date.now(),
      generation: 1,
      destination: topic,
      consumerGroup,
    },
    revokeEvent: {
      type: 'revoked',
      partitions: assignments,
      timestamp: Date.now() + 1000,
      generation: 2,
      destination: topic,
      consumerGroup,
    },
  };
}

/**
 * Create an out-of-order scenario
 */
export function createOutOfOrderScenario<T>(
  payloads: T[],
  outOfOrderIndices: number[],
): MockMessage<T>[] {
  const messages = createMockMessageBatch(payloads, { addTraceHeaders: true });

  // Shuffle specified indices to create out-of-order scenario
  const shuffled = [...messages];
  for (const index of outOfOrderIndices) {
    if (index > 0 && index < shuffled.length) {
      // Swap with previous to create out-of-order
      const prev = shuffled[index - 1]!;
      const curr = shuffled[index]!;
      shuffled[index - 1] = curr;
      shuffled[index] = prev;
    }
  }

  return shuffled;
}

/**
 * Create a duplicate message scenario
 */
export function createDuplicateScenario<T>(
  payloads: T[],
  duplicateIndices: number[],
): MockMessage<T>[] {
  const messages = createMockMessageBatch(payloads, { addTraceHeaders: true });
  const result = [...messages];

  for (const index of duplicateIndices) {
    const originalMessage = messages[index];
    if (index >= 0 && index < messages.length && originalMessage) {
      // Insert duplicate after the original
      result.splice(index + 1, 0, { ...originalMessage });
    }
  }

  return result;
}
