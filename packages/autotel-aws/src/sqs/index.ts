/**
 * SQS-specific instrumentation
 *
 * Provides semantic helpers for tracing SQS operations with proper OpenTelemetry
 * messaging semantic conventions. Automatically sets `messaging.*` and `aws.sqs.*` attributes.
 *
 * @example Send message
 * ```typescript
 * import { traceSQS } from 'autotel-aws/sqs';
 * import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
 *
 * const sqs = new SQSClient({});
 *
 * export const sendMessage = traceSQS({
 *   operation: 'send',
 *   queueName: 'my-queue',
 *   queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'
 * })(ctx => async (body: string, attributes?: Record<string, string>) => {
 *   const result = await sqs.send(new SendMessageCommand({
 *     QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
 *     MessageBody: body,
 *     MessageAttributes: attributes
 *   }));
 *
 *   if (result.MessageId) {
 *     ctx.setAttribute('messaging.message.id', result.MessageId);
 *   }
 *
 *   return result;
 * });
 *
 * // Usage: await sendMessage('Hello!', { correlationId: { StringValue: '123', DataType: 'String' } });
 * ```
 *
 * @example Receive and process messages
 * ```typescript
 * export const receiveMessages = traceSQS({
 *   operation: 'receive',
 *   queueName: 'my-queue'
 * })(ctx => async (maxMessages: number) => {
 *   const result = await sqs.send(new ReceiveMessageCommand({
 *     QueueUrl: 'https://sqs.../my-queue',
 *     MaxNumberOfMessages: maxMessages
 *   }));
 *
 *   ctx.setAttribute('messaging.batch.message_count', result.Messages?.length ?? 0);
 *   return result.Messages;
 * });
 * ```
 */

import { trace, type TraceContext } from 'autotel';
import { context, propagation, SpanStatusCode } from '@opentelemetry/api';
import { buildSQSAttributes } from '../attributes';
import { wrapSDKClient } from '../common/sdk-wrapper';

/**
 * SQS operation configuration
 */
export interface TraceSQSConfig {
  /**
   * SQS operation type
   * - 'send' - SendMessage, SendMessageBatch
   * - 'receive' - ReceiveMessage
   */
  operation: 'send' | 'receive';

  /**
   * Queue name (last segment of queue URL)
   * Sets `messaging.destination.name` attribute.
   */
  queueName: string;

  /**
   * Full queue URL
   * Sets `aws.sqs.queue_url` attribute.
   */
  queueUrl?: string;
}

/**
 * Trace SQS operations with semantic attributes
 *
 * Creates a traced function that automatically sets SQS messaging semantic attributes
 * following OpenTelemetry conventions.
 *
 * @param config - SQS operation configuration
 * @returns A higher-order function that wraps your SQS operation with tracing
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `messaging.system` - 'aws_sqs'
 * - `messaging.destination.name` - Queue name
 * - `messaging.operation` - 'send' or 'receive'
 * - `aws.sqs.queue_url` - Full queue URL (if provided)
 *
 * Additional attributes you should set in your handler:
 * - `messaging.message.id` - Message ID from response
 * - `messaging.batch.message_count` - Number of messages in batch
 *
 * @see https://opentelemetry.io/docs/specs/semconv/messaging/aws-sqs/
 */
export function traceSQS(config: TraceSQSConfig) {
  return function wrapper<TArgs extends unknown[], TReturn>(
    fn: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    // Use autotel's trace() which properly handles the factory pattern
    return trace(
      `sqs.${config.operation}`,
      (ctx: TraceContext) =>
        async (...args: TArgs): Promise<TReturn> => {
          // Set SQS semantic attributes
          ctx.setAttributes(
            buildSQSAttributes({
              queueName: config.queueName,
              queueUrl: config.queueUrl,
              operation: config.operation,
            }),
          );

          // Get the user's handler and execute with forwarded arguments
          const handler = fn(ctx);
          return handler(...args);
        },
    );
  };
}

// ============================================================================
// SQS Producer - Sends messages with automatic trace context injection
// ============================================================================

/**
 * Configuration for SQS Producer
 */
export interface SQSProducerConfig {
  /**
   * Full SQS queue URL
   */
  queueUrl: string;

  /**
   * Inject W3C Trace Context into message attributes
   * Enables distributed tracing across producer/consumer
   * @default true
   */
  injectTraceContext?: boolean;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Message to send via SQS Producer
 */
export interface SQSMessage {
  /**
   * Message body (string)
   */
  body: string;

  /**
   * Optional message attributes
   */
  attributes?: Record<string, { StringValue: string; DataType: string }>;

  /**
   * Optional message group ID (for FIFO queues)
   */
  messageGroupId?: string;

  /**
   * Optional deduplication ID (for FIFO queues)
   */
  messageDeduplicationId?: string;

  /**
   * Optional delay in seconds (0-900)
   */
  delaySeconds?: number;
}

/**
 * SQS Producer with automatic trace context injection
 *
 * Wraps an SQS client to automatically:
 * - Create spans for send operations
 * - Inject W3C Trace Context into message attributes
 * - Set proper semantic attributes
 *
 * @example Basic usage
 * ```typescript
 * import { SQSProducer } from 'autotel-aws/sqs';
 * import { SQSClient } from '@aws-sdk/client-sqs';
 *
 * const sqs = new SQSClient({ region: 'us-east-1' });
 * const producer = new SQSProducer(sqs, {
 *   queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'
 * });
 *
 * // Send with automatic trace context
 * const result = await producer.send({ body: 'Hello!' });
 * console.log('Message ID:', result.messageId);
 * ```
 *
 * @example With custom attributes
 * ```typescript
 * await producer.send({
 *   body: JSON.stringify({ orderId: '12345' }),
 *   attributes: {
 *     'correlationId': { StringValue: 'abc-123', DataType: 'String' },
 *     'eventType': { StringValue: 'ORDER_CREATED', DataType: 'String' }
 *   }
 * });
 * ```
 *
 * @example Batch send
 * ```typescript
 * const results = await producer.sendBatch([
 *   { body: 'Message 1' },
 *   { body: 'Message 2' },
 *   { body: 'Message 3' }
 * ]);
 * console.log(`Sent ${results.successful.length} messages`);
 * ```
 */
export class SQSProducer<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<Pick<SQSProducerConfig, 'queueUrl'>> & SQSProducerConfig;
  private queueName: string;

  constructor(client: TClient, config: SQSProducerConfig) {
    // Wrap the client for basic tracing if not already wrapped
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      injectTraceContext: true,
      ...config,
    };
    // Extract queue name from URL
    this.queueName = config.queueUrl.split('/').pop() || 'unknown';
  }

  /**
   * Inject trace context into message attributes
   */
  private injectContext(
    attributes?: Record<string, { StringValue: string; DataType: string }>,
  ): Record<string, { StringValue: string; DataType: string }> {
    if (!this.config.injectTraceContext) {
      return attributes || {};
    }

    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    const result = { ...attributes };

    if (carrier.traceparent) {
      result.traceparent = { StringValue: carrier.traceparent, DataType: 'String' };
    }
    if (carrier.tracestate) {
      result.tracestate = { StringValue: carrier.tracestate, DataType: 'String' };
    }
    if (carrier.baggage) {
      result.baggage = { StringValue: carrier.baggage, DataType: 'String' };
    }

    return result;
  }

  /**
   * Send a single message to the queue
   *
   * @param message - Message to send
   * @returns Promise with message ID and other metadata
   */
  async send(message: SQSMessage): Promise<{
    messageId?: string;
    sequenceNumber?: string;
    md5OfMessageBody?: string;
  }> {
    return trace(`sqs.send`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildSQSAttributes({
          queueName: this.queueName,
          queueUrl: this.config.queueUrl,
          operation: 'send',
        }),
      );

      // Build command input
      const input = {
        QueueUrl: this.config.queueUrl,
        MessageBody: message.body,
        MessageAttributes: this.injectContext(message.attributes),
        ...(message.messageGroupId && { MessageGroupId: message.messageGroupId }),
        ...(message.messageDeduplicationId && {
          MessageDeduplicationId: message.messageDeduplicationId,
        }),
        ...(message.delaySeconds !== undefined && { DelaySeconds: message.delaySeconds }),
      };

      // Dynamically import the command to avoid requiring @aws-sdk/client-sqs at load time
      try {
        const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
        const result = await this.client.send(new SendMessageCommand(input));

        if (result.MessageId) {
          ctx.setAttribute('messaging.message.id', result.MessageId);
        }

        ctx.setStatus({ code: SpanStatusCode.OK });

        return {
          messageId: result.MessageId,
          sequenceNumber: result.SequenceNumber,
          md5OfMessageBody: result.MD5OfMessageBody,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Send failed',
        });
        throw error;
      }
    });
  }

  /**
   * Send multiple messages in a batch
   *
   * @param messages - Array of messages to send (max 10)
   * @returns Promise with successful and failed message results
   */
  async sendBatch(messages: SQSMessage[]): Promise<{
    successful: Array<{ id: string; messageId?: string; sequenceNumber?: string }>;
    failed: Array<{ id: string; code?: string; message?: string }>;
  }> {
    return trace(`sqs.sendBatch`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildSQSAttributes({
          queueName: this.queueName,
          queueUrl: this.config.queueUrl,
          operation: 'send',
        }),
      );
      ctx.setAttribute('messaging.batch.message_count', messages.length);

      // Build batch entries
      const entries = messages.map((message, index) => ({
        Id: String(index),
        MessageBody: message.body,
        MessageAttributes: this.injectContext(message.attributes),
        ...(message.messageGroupId && { MessageGroupId: message.messageGroupId }),
        ...(message.messageDeduplicationId && {
          MessageDeduplicationId: message.messageDeduplicationId,
        }),
        ...(message.delaySeconds !== undefined && { DelaySeconds: message.delaySeconds }),
      }));

      try {
        const { SendMessageBatchCommand } = await import('@aws-sdk/client-sqs');
        const result = await this.client.send(
          new SendMessageBatchCommand({
            QueueUrl: this.config.queueUrl,
            Entries: entries,
          }),
        );

        const successful =
          result.Successful?.map((s: { Id?: string; MessageId?: string; SequenceNumber?: string }) => ({
            id: s.Id!,
            messageId: s.MessageId,
            sequenceNumber: s.SequenceNumber,
          })) || [];

        const failed =
          result.Failed?.map((f: { Id?: string; Code?: string; Message?: string }) => ({
            id: f.Id!,
            code: f.Code,
            message: f.Message,
          })) || [];

        ctx.setAttribute('messaging.sqs.successful_count', successful.length);
        ctx.setAttribute('messaging.sqs.failed_count', failed.length);

        if (failed.length > 0) {
          ctx.setStatus({
            code: SpanStatusCode.ERROR,
            message: `${failed.length} messages failed`,
          });
        } else {
          ctx.setStatus({ code: SpanStatusCode.OK });
        }

        return { successful, failed };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Batch send failed',
        });
        throw error;
      }
    });
  }
}

// ============================================================================
// SQS Consumer - Receives and processes messages with trace context extraction
// ============================================================================

/**
 * Configuration for SQS Consumer
 */
export interface SQSConsumerConfig {
  /**
   * Full SQS queue URL
   */
  queueUrl: string;

  /**
   * Extract W3C Trace Context from message attributes
   * Creates child spans linked to the producer
   * @default true
   */
  extractTraceContext?: boolean;

  /**
   * Maximum number of messages to receive per poll
   * @default 10
   */
  maxMessages?: number;

  /**
   * Visibility timeout in seconds
   * @default 30
   */
  visibilityTimeout?: number;

  /**
   * Wait time for long polling in seconds (0-20)
   * @default 20
   */
  waitTimeSeconds?: number;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Received SQS message with parsed attributes
 */
export interface ReceivedSQSMessage {
  /**
   * Message ID
   */
  messageId: string;

  /**
   * Receipt handle for deletion
   */
  receiptHandle: string;

  /**
   * Message body (string)
   */
  body: string;

  /**
   * Parsed message attributes
   */
  attributes: Record<string, string>;

  /**
   * System attributes (ApproximateReceiveCount, etc.)
   */
  systemAttributes: Record<string, string>;

  /**
   * Original AWS SDK message object
   */
   
  raw: any;
}

/**
 * Message processor function type
 */
export type MessageProcessor = (
  message: ReceivedSQSMessage,
  ctx: TraceContext,
) => Promise<void>;

/**
 * SQS Consumer with automatic trace context extraction
 *
 * Wraps an SQS client to automatically:
 * - Create spans for receive/process operations
 * - Extract W3C Trace Context from message attributes
 * - Link consumer spans to producer spans
 * - Delete messages after successful processing
 *
 * @example Basic usage
 * ```typescript
 * import { SQSConsumer } from 'autotel-aws/sqs';
 * import { SQSClient } from '@aws-sdk/client-sqs';
 *
 * const sqs = new SQSClient({ region: 'us-east-1' });
 * const consumer = new SQSConsumer(sqs, {
 *   queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'
 * });
 *
 * // Process messages with automatic tracing
 * await consumer.processMessages(async (message, ctx) => {
 *   ctx.setAttribute('order.id', JSON.parse(message.body).orderId);
 *   await handleOrder(message.body);
 * });
 * ```
 *
 * @example With polling loop
 * ```typescript
 * // Start continuous polling
 * const controller = new AbortController();
 *
 * consumer.poll(async (message, ctx) => {
 *   await processMessage(message);
 * }, { signal: controller.signal });
 *
 * // Stop polling gracefully
 * controller.abort();
 * ```
 */
export class SQSConsumer<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<
    Pick<SQSConsumerConfig, 'queueUrl' | 'maxMessages' | 'visibilityTimeout' | 'waitTimeSeconds'>
  > &
    SQSConsumerConfig;
  private queueName: string;

  constructor(client: TClient, config: SQSConsumerConfig) {
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      extractTraceContext: true,
      maxMessages: 10,
      visibilityTimeout: 30,
      waitTimeSeconds: 20,
      ...config,
    };
    this.queueName = config.queueUrl.split('/').pop() || 'unknown';
  }

  /**
   * Extract trace context from message attributes
   */
   
  private extractContext(messageAttributes: any): Record<string, string> | undefined {
    if (!this.config.extractTraceContext || !messageAttributes) {
      return undefined;
    }

    const carrier: Record<string, string> = {};

    if (messageAttributes.traceparent?.StringValue) {
      carrier.traceparent = messageAttributes.traceparent.StringValue;
    }
    if (messageAttributes.tracestate?.StringValue) {
      carrier.tracestate = messageAttributes.tracestate.StringValue;
    }
    if (messageAttributes.baggage?.StringValue) {
      carrier.baggage = messageAttributes.baggage.StringValue;
    }

    return Object.keys(carrier).length > 0 ? carrier : undefined;
  }

  /**
   * Parse AWS SDK message into our format
   */
   
  private parseMessage(message: any): ReceivedSQSMessage {
    const attributes: Record<string, string> = {};
    if (message.MessageAttributes) {
      for (const [key, value] of Object.entries(message.MessageAttributes)) {
         
        attributes[key] = (value as any).StringValue || '';
      }
    }

    return {
      messageId: message.MessageId || '',
      receiptHandle: message.ReceiptHandle || '',
      body: message.Body || '',
      attributes,
      systemAttributes: message.Attributes || {},
      raw: message,
    };
  }

  /**
   * Receive messages from the queue
   *
   * @returns Array of received messages
   */
  async receive(): Promise<ReceivedSQSMessage[]> {
    return trace(`sqs.receive`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildSQSAttributes({
          queueName: this.queueName,
          queueUrl: this.config.queueUrl,
          operation: 'receive',
        }),
      );

      try {
        const { ReceiveMessageCommand } = await import('@aws-sdk/client-sqs');
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.config.queueUrl,
            MaxNumberOfMessages: this.config.maxMessages,
            VisibilityTimeout: this.config.visibilityTimeout,
            WaitTimeSeconds: this.config.waitTimeSeconds,
            MessageAttributeNames: ['All'],
            AttributeNames: ['All'],
          }),
        );

         
        const messages = (result.Messages || []).map((m: any) => this.parseMessage(m));
        ctx.setAttribute('messaging.batch.message_count', messages.length);
        ctx.setStatus({ code: SpanStatusCode.OK });

        return messages;
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Receive failed',
        });
        throw error;
      }
    });
  }

  /**
   * Delete a message from the queue
   *
   * @param receiptHandle - Receipt handle of the message to delete
   */
  async delete(receiptHandle: string): Promise<void> {
    const { DeleteMessageCommand } = await import('@aws-sdk/client-sqs');
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  /**
   * Process messages with automatic trace context extraction
   *
   * Receives messages, processes each with the provided handler,
   * and deletes successfully processed messages.
   *
   * @param processor - Function to process each message
   * @returns Number of messages processed
   */
  async processMessages(processor: MessageProcessor): Promise<number> {
    const messages = await this.receive();
    let processed = 0;

    for (const message of messages) {
      // Extract trace context from message attributes
      const carrier = this.extractContext(message.raw.MessageAttributes);

      // Create processing span, optionally linked to producer
      const processMessage = async () => {
        return trace(`sqs.process`, async (ctx: TraceContext) => {
          ctx.setAttributes(
            buildSQSAttributes({
              queueName: this.queueName,
              queueUrl: this.config.queueUrl,
              operation: 'receive',
            }),
          );
          ctx.setAttribute('messaging.message.id', message.messageId);

          try {
            await processor(message, ctx);
            await this.delete(message.receiptHandle);
            processed++;
            ctx.setStatus({ code: SpanStatusCode.OK });
          } catch (error) {
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : 'Processing failed',
            });
            throw error;
          }
        });
      };

      // Run with extracted context if available
      if (carrier) {
        const extractedContext = propagation.extract(context.active(), carrier);
        await context.with(extractedContext, processMessage);
      } else {
        await processMessage();
      }
    }

    return processed;
  }

  /**
   * Start continuous polling loop
   *
   * @param processor - Function to process each message
   * @param options - Polling options including abort signal
   */
  async poll(
    processor: MessageProcessor,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    while (!options?.signal?.aborted) {
      try {
        await this.processMessages(processor);
      } catch (error) {
        // Log error but continue polling
        console.error('[SQSConsumer] Error processing messages:', error);
        // Small delay before retrying on error
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}
