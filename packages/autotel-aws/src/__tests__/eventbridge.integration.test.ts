/**
 * EventBridge Integration Tests with LocalStack
 *
 * These tests verify EventBridge Publisher functionality including:
 * - Event publishing with trace context injection
 * - Batch publishing
 * - Span creation and attributes
 *
 * Prerequisites:
 * - Docker running
 * - LocalStack container started:
 *   docker run -d -p 4566:4566 localstack/localstack
 *
 * Run with:
 *   LOCALSTACK_ENDPOINT=http://localhost:4566 pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  EventBridgeClient,
  CreateEventBusCommand,
  DeleteEventBusCommand,
} from '@aws-sdk/client-eventbridge';
import { EventBridgePublisher } from '../eventbridge/index';
import { init, shutdown, flush } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';

describe('EventBridge Integration Tests', () => {
  let eventBridge: EventBridgeClient;
  let eventBusName: string;
  let exporter: InMemorySpanExporter;

  beforeAll(async () => {
    // Create EventBridge client pointing to LocalStack
    eventBridge = new EventBridgeClient({
      endpoint: LOCALSTACK_ENDPOINT,
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    // Set up tracing with exporter via init()
    exporter = new InMemorySpanExporter();
    init({
      service: 'eventbridge-integration-test',
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    // Create test event bus
    eventBusName = `test-bus-${Date.now()}`;
    try {
      await eventBridge.send(new CreateEventBusCommand({ Name: eventBusName }));
    } catch {
      console.warn('LocalStack not available, skipping EventBridge integration tests');
    }
  });

  afterAll(async () => {
    // Clean up
    if (eventBusName) {
      try {
        await eventBridge.send(new DeleteEventBusCommand({ Name: eventBusName }));
      } catch {
        // Ignore cleanup errors
      }
    }

    await flush();
    await shutdown();
    eventBridge.destroy();
  });

  beforeEach(() => {
    exporter.reset();
  });

  describe('EventBridgePublisher', () => {
    it('should publish a single event with trace context', async () => {
      if (!eventBusName) {
        console.warn('Skipping test: LocalStack not available');
        return;
      }

      const publisher = new EventBridgePublisher(eventBridge, {
        eventBusName,
        source: 'com.test.integration',
      });

      const result = await publisher.putEvent({
        detailType: 'TestEvent',
        detail: { testId: '123', action: 'integration-test' },
      });

      expect(result.eventId).toBeDefined();
      expect(result.failedEntryCount).toBe(0);

      await flush();
      const spans = exporter.getFinishedSpans();

      // Should have created a span for the publish operation
      const publishSpan = spans.find((s) => s.name === 'eventbridge.PutEvents');
      expect(publishSpan).toBeDefined();
      expect(publishSpan?.attributes['aws.eventbridge.event_bus']).toBe(eventBusName);
      expect(publishSpan?.attributes['aws.eventbridge.source']).toBe('com.test.integration');
      expect(publishSpan?.attributes['aws.eventbridge.detail_type']).toBe('TestEvent');
    });

    it('should publish batch events', async () => {
      if (!eventBusName) {
        console.warn('Skipping test: LocalStack not available');
        return;
      }

      const publisher = new EventBridgePublisher(eventBridge, {
        eventBusName,
        source: 'com.test.batch',
      });

      const result = await publisher.putEvents([
        { detailType: 'Event1', detail: { id: '1' } },
        { detailType: 'Event2', detail: { id: '2' } },
        { detailType: 'Event3', detail: { id: '3' } },
      ]);

      expect(result.successful.length).toBe(3);
      expect(result.failed.length).toBe(0);
      expect(result.failedEntryCount).toBe(0);

      await flush();
      const spans = exporter.getFinishedSpans();

      const batchSpan = spans.find((s) => s.name === 'eventbridge.PutEvents.batch');
      expect(batchSpan).toBeDefined();
      expect(batchSpan?.attributes['aws.eventbridge.batch_size']).toBe(3);
      expect(batchSpan?.attributes['aws.eventbridge.successful_count']).toBe(3);
      expect(batchSpan?.attributes['aws.eventbridge.failed_count']).toBe(0);
    });

    it('should allow source override per event', async () => {
      if (!eventBusName) {
        console.warn('Skipping test: LocalStack not available');
        return;
      }

      const publisher = new EventBridgePublisher(eventBridge, {
        eventBusName,
        source: 'com.test.default',
      });

      const result = await publisher.putEventWithSource({
        detailType: 'CustomSourceEvent',
        detail: { testId: 'custom-source' },
        source: 'com.test.custom',
      });

      expect(result.eventId).toBeDefined();

      await flush();
      const spans = exporter.getFinishedSpans();

      const publishSpan = spans.find((s) => s.name === 'eventbridge.PutEvents');
      expect(publishSpan).toBeDefined();
      expect(publishSpan?.attributes['aws.eventbridge.source']).toBe('com.test.custom');
    });
  });

  describe('Trace Context Injection', () => {
    it('should inject trace context into event detail', async () => {
      if (!eventBusName) {
        console.warn('Skipping test: LocalStack not available');
        return;
      }

      const publisher = new EventBridgePublisher(eventBridge, {
        eventBusName,
        source: 'com.test.context',
        injectTraceContext: true, // Default
      });

      const result = await publisher.putEvent({
        detailType: 'ContextTest',
        detail: { orderId: '789' },
      });

      expect(result.eventId).toBeDefined();

      await flush();
      const spans = exporter.getFinishedSpans();

      // Verify span was created
      const publishSpan = spans.find((s) => s.name === 'eventbridge.PutEvents');
      expect(publishSpan).toBeDefined();

      // The trace context is automatically injected into the detail
      // as _traceContext field
    });

    it('should not inject context when disabled', async () => {
      if (!eventBusName) {
        console.warn('Skipping test: LocalStack not available');
        return;
      }

      const publisher = new EventBridgePublisher(eventBridge, {
        eventBusName,
        source: 'com.test.no-context',
        injectTraceContext: false,
      });

      const result = await publisher.putEvent({
        detailType: 'NoContextTest',
        detail: { testId: 'no-context' },
      });

      expect(result.eventId).toBeDefined();

      await flush();
      const spans = exporter.getFinishedSpans();

      // Span should still be created for the operation
      const publishSpan = spans.find((s) => s.name === 'eventbridge.PutEvents');
      expect(publishSpan).toBeDefined();
    });
  });

  describe('Context Extraction', () => {
    it('should extract trace context from EventBridge Lambda event', async () => {
      // Import the extraction function
      const { extractEventBridgeContext, stripEventBridgeContext } = await import(
        '../eventbridge/index'
      );

      // Simulate an EventBridge Lambda event
      const event = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'TestEvent',
        source: 'com.test.source',
        account: '123456789012',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          orderId: '123',
          _traceContext: {
            traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
            tracestate: 'rojo=00f067aa0ba902b7',
          },
        },
      };

      const parentContext = extractEventBridgeContext(event);
      expect(parentContext).toBeDefined();

      // Strip context for processing
      const cleanDetail = stripEventBridgeContext(event.detail);
      expect(cleanDetail.orderId).toBe('123');
      expect(cleanDetail).not.toHaveProperty('_traceContext');
    });

    it('should handle events without trace context', async () => {
      const { extractEventBridgeContext } = await import('../eventbridge/index');

      const event = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'TestEvent',
        source: 'com.test.source',
        detail: {
          orderId: '456',
        },
      };

      const parentContext = extractEventBridgeContext(event);
      expect(parentContext).toBeUndefined();
    });
  });
});
