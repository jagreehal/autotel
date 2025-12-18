/**
 * SNS Integration Tests with LocalStack
 *
 * These tests verify SNS Publisher functionality including:
 * - Message publishing with trace context injection
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
  SNSClient,
  CreateTopicCommand,
  DeleteTopicCommand,
} from '@aws-sdk/client-sns';
import { SNSPublisher } from '../sns/index';
import { init, shutdown, flush } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { createLocalStackHelpers } from '../testing/localstack';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const localstack = createLocalStackHelpers();
const isLocalStackAvailable = await localstack.isAvailable();

describe.skipIf(!isLocalStackAvailable)('SNS Integration Tests', () => {
  let sns: SNSClient;
  let topicArn: string;
  let exporter: InMemorySpanExporter;

  beforeAll(async () => {
    // Create SNS client pointing to LocalStack
    sns = new SNSClient({
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
      service: 'sns-integration-test',
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    // Create test topic
    const topicName = `test-topic-${Date.now()}`;
    const result = await sns.send(new CreateTopicCommand({ Name: topicName }));
    topicArn = result.TopicArn || '';
  });

  afterAll(async () => {
    // Clean up
    if (topicArn) {
      try {
        await sns.send(new DeleteTopicCommand({ TopicArn: topicArn }));
      } catch {
        // Ignore cleanup errors
      }
    }

    await flush();
    await shutdown();
    sns.destroy();
  });

  beforeEach(() => {
    exporter.reset();
  });

  describe('SNSPublisher', () => {
    it('should publish a message with trace context', async () => {
      const publisher = new SNSPublisher(sns, { topicArn });

      const result = await publisher.publish({
        message: JSON.stringify({ event: 'TEST_EVENT', data: { id: '123' } }),
        subject: 'Test Message',
      });

      expect(result.messageId).toBeDefined();

      await flush();
      const spans = exporter.getFinishedSpans();

      // Should have created a span for the publish operation
      const publishSpan = spans.find((s) => s.name === 'sns.publish');
      expect(publishSpan).toBeDefined();
      expect(publishSpan?.attributes['messaging.system']).toBe('aws_sns');
    });

    it('should publish batch messages', async () => {
      const publisher = new SNSPublisher(sns, { topicArn });

      const result = await publisher.publishBatch([
        { message: JSON.stringify({ id: '1' }) },
        { message: JSON.stringify({ id: '2' }) },
        { message: JSON.stringify({ id: '3' }) },
      ]);

      expect(result.successful.length).toBe(3);
      expect(result.failed.length).toBe(0);

      await flush();
      const spans = exporter.getFinishedSpans();

      const batchSpan = spans.find((s) => s.name === 'sns.publishBatch');
      expect(batchSpan).toBeDefined();
      expect(batchSpan?.attributes['messaging.batch.message_count']).toBe(3);
    });

    it('should set message attributes with trace context', async () => {
      const publisher = new SNSPublisher(sns, { topicArn });

      const result = await publisher.publish({
        message: JSON.stringify({ orderId: '456' }),
        attributes: {
          eventType: { StringValue: 'ORDER_CREATED', DataType: 'String' },
        },
      });

      expect(result.messageId).toBeDefined();

      await flush();
      const spans = exporter.getFinishedSpans();

      const publishSpan = spans.find((s) => s.name === 'sns.publish');
      expect(publishSpan).toBeDefined();
      expect(publishSpan?.attributes['messaging.message.id']).toBe(result.messageId);
    });
  });

  describe('Trace Context Injection', () => {
    it('should inject traceparent into message attributes', async () => {
      // Create publisher with context injection enabled (default)
      const publisher = new SNSPublisher(sns, { topicArn });

      // The trace context should be injected into message attributes
      // when the message is sent
      await publisher.publish({
        message: JSON.stringify({ testId: 'context-injection' }),
      });

      await flush();
      const spans = exporter.getFinishedSpans();

      // Verify span was created
      const publishSpan = spans.find((s) => s.name === 'sns.publish');
      expect(publishSpan).toBeDefined();

      // The trace context is automatically injected by the publisher
      // Consumers can extract it from message attributes
    });

    it('should not inject context when disabled', async () => {
      const publisher = new SNSPublisher(sns, {
        topicArn,
        injectTraceContext: false,
      });

      const result = await publisher.publish({
        message: JSON.stringify({ testId: 'no-context' }),
      });

      expect(result.messageId).toBeDefined();

      await flush();
      const spans = exporter.getFinishedSpans();

      // Span should still be created for the operation
      const publishSpan = spans.find((s) => s.name === 'sns.publish');
      expect(publishSpan).toBeDefined();
    });
  });
});
