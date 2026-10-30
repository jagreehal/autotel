/**
 * SQS Integration Tests with LocalStack
 *
 * These tests verify SQS Producer/Consumer functionality including:
 * - Message sending with trace context injection
 * - Message receiving with trace context extraction
 * - Batch operations
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
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
} from '@aws-sdk/client-sqs';
import { SQSProducer, SQSConsumer } from '../sqs/index';
import { init, shutdown, flush } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { createLocalStackHelpers } from '../testing/localstack';

// Skip if LocalStack is not available
const LOCALSTACK_ENDPOINT =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const localstack = createLocalStackHelpers();
const isLocalStackAvailable = await localstack.isAvailable();

describe.skipIf(!isLocalStackAvailable)('SQS Integration Tests', () => {
  let sqs: SQSClient;
  let queueUrl: string;
  let queueName: string;
  let exporter: InMemorySpanExporter;

  beforeAll(async () => {
    // Create SQS client pointing to LocalStack
    sqs = new SQSClient({
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
      service: 'sqs-integration-test',
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    // Create test queue
    queueName = `test-queue-${Date.now()}`;
    await sqs.send(new CreateQueueCommand({ QueueName: queueName }));
    const urlResult = await sqs.send(
      new GetQueueUrlCommand({ QueueName: queueName }),
    );
    queueUrl = urlResult.QueueUrl || '';
  });

  afterAll(async () => {
    // Clean up
    if (queueUrl) {
      try {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
      } catch {
        // Ignore cleanup errors
      }
    }

    await flush();
    await shutdown();
    sqs.destroy();
  });

  beforeEach(() => {
    exporter.reset();
  });

  describe('SQSProducer', () => {
    it('should send a message with trace context', async () => {
      const producer = new SQSProducer(sqs, { queueUrl });

      const result = await producer.send({
        body: JSON.stringify({ orderId: '123', action: 'test' }),
      });

      expect(result.messageId).toBeDefined();

      await flush();
      const spans = exporter.getFinishedSpans();

      // Should have created a span for the send operation
      const sendSpan = spans.find((s) => s.name === 'sqs.send');
      expect(sendSpan).toBeDefined();
      expect(sendSpan?.attributes['messaging.system']).toBe('aws_sqs');
      expect(sendSpan?.attributes['messaging.operation.type']).toBe('send');
    });

    it('should send batch messages', async () => {
      const producer = new SQSProducer(sqs, { queueUrl });

      const result = await producer.sendBatch([
        { body: JSON.stringify({ id: '1' }) },
        { body: JSON.stringify({ id: '2' }) },
        { body: JSON.stringify({ id: '3' }) },
      ]);

      expect(result.successful.length).toBe(3);
      expect(result.failed.length).toBe(0);

      await flush();
      const spans = exporter.getFinishedSpans();

      const batchSpan = spans.find((s) => s.name === 'sqs.sendBatch');
      expect(batchSpan).toBeDefined();
      expect(batchSpan?.attributes['messaging.batch.message_count']).toBe(3);
    });
  });

  describe('SQSConsumer', () => {
    it('should receive messages and process with trace context', async () => {
      const producer = new SQSProducer(sqs, { queueUrl });
      const consumer = new SQSConsumer(sqs, {
        queueUrl,
        waitTimeSeconds: 1,
        maxMessages: 10,
      });

      // Use unique test ID to avoid cross-test contamination
      const testId = `receive-test-${Date.now()}`;

      // Send a message with unique identifier
      await producer.send({
        body: JSON.stringify({ orderId: testId, action: 'receive-test' }),
      });

      // Receive messages and find our specific one
      const messages = await consumer.receive();

      expect(messages.length).toBeGreaterThan(0);

      // Find our specific message (in case queue has leftover messages)
      const ourMessage = messages.find((m) => {
        try {
          const body = JSON.parse(m.body || '{}');
          return body.orderId === testId;
        } catch {
          return false;
        }
      });

      expect(ourMessage).toBeDefined();
      expect(ourMessage!.body).toBeDefined();

      // Parse body and verify
      const body = JSON.parse(ourMessage!.body!);
      expect(body.orderId).toBe(testId);

      // Delete all received messages to clean up
      for (const msg of messages) {
        await consumer.delete(msg.receiptHandle!);
      }

      await flush();
      const spans = exporter.getFinishedSpans();

      const receiveSpan = spans.find((s) => s.name === 'sqs.receive');
      expect(receiveSpan).toBeDefined();
    });

    it('should process messages with callback', async () => {
      const producer = new SQSProducer(sqs, { queueUrl });
      const consumer = new SQSConsumer(sqs, {
        queueUrl,
        waitTimeSeconds: 1,
        maxMessages: 10,
      });

      // Send a message
      await producer.send({
        body: JSON.stringify({ orderId: '789', action: 'callback-test' }),
      });

      // Process with callback
      let processedOrder: string | undefined;

      await consumer.processMessages(async (message, ctx) => {
        const body = JSON.parse(message.body!);
        processedOrder = body.orderId;
        ctx.setAttribute('order.id', body.orderId);
      });

      expect(processedOrder).toBe('789');

      await flush();
      const spans = exporter.getFinishedSpans();

      const processSpan = spans.find((s) => s.name === `process ${queueName}`);
      expect(processSpan).toBeDefined();
    });

    it('keeps processing the batch after a message fails', async () => {
      const producer = new SQSProducer(sqs, { queueUrl });
      const consumer = new SQSConsumer(sqs, {
        queueUrl,
        waitTimeSeconds: 1,
        maxMessages: 10,
      });
      const testId = `batch-${Date.now()}`;
      await producer.sendBatch(
        ['poison', 'ok-1', 'ok-2'].map((step) => ({
          body: JSON.stringify({ testId, step }),
        })),
      );

      const handled: string[] = [];
      let processed = 0;
      for (let poll = 0; poll < 5 && handled.length < 3; poll++) {
        processed += await consumer.processMessages(async (message, ctx) => {
          const body = JSON.parse(message.body);
          if (body.testId !== testId) return;
          handled.push(body.step);
          if (body.step === 'poison') {
            ctx.recordDLQ('unparseable order', 'orders-dlq', {
              reasonCategory: 'validation',
            });
            throw new Error('unparseable order');
          }
        });
      }

      expect(handled).toHaveLength(3);
      expect(handled).toEqual(
        expect.arrayContaining(['ok-1', 'ok-2', 'poison']),
      );
      expect(processed).toBeGreaterThanOrEqual(2);
      await flush();
      const failed = exporter
        .getFinishedSpans()
        .find(
          (s) =>
            s.name === `process ${queueName}` &&
            s.attributes['messaging.dlq.reason'] === 'unparseable order',
        );
      expect(failed?.attributes['messaging.dlq.reason_category']).toBe(
        'validation',
      );
    });
  });

  describe('Context Propagation', () => {
    it('should propagate trace context from producer to consumer', async () => {
      const producer = new SQSProducer(sqs, { queueUrl });
      const consumer = new SQSConsumer(sqs, {
        queueUrl,
        waitTimeSeconds: 1,
        maxMessages: 10,
      });

      // Send message
      await producer.send({
        body: JSON.stringify({ testId: 'context-propagation' }),
      });

      // Receive and verify trace context was extracted
      await consumer.processMessages(async (_message, ctx) => {
        // The consumer should have extracted the parent trace context
        // and created a child span linked to it
        ctx.setAttribute('processing.test', 'context-propagation');
      });

      await flush();
      const spans = exporter.getFinishedSpans();

      // The queue is shared across tests, so match on the link itself.
      const sendSpan = spans.find((s) => s.name === 'sqs.send');
      expect(sendSpan).toBeDefined();
      const linked = spans.filter(
        (s) =>
          s.name === `process ${queueName}` &&
          s.links.some(
            (link) => link.context.spanId === sendSpan!.spanContext().spanId,
          ),
      );
      expect(linked).toHaveLength(1);
    });
  });
});
