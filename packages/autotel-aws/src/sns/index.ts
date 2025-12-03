/**
 * SNS-specific instrumentation
 *
 * Provides semantic helpers for tracing SNS operations with proper OpenTelemetry
 * messaging semantic conventions. Automatically sets `messaging.*` attributes.
 *
 * @example Publish to topic
 * ```typescript
 * import { traceSNS } from 'autotel-aws/sns';
 * import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
 *
 * const sns = new SNSClient({});
 *
 * export const publishNotification = traceSNS({
 *   topicArn: 'arn:aws:sns:us-east-1:123456789:notifications'
 * })(ctx => async (message: string, subject?: string) => {
 *   const result = await sns.send(new PublishCommand({
 *     TopicArn: 'arn:aws:sns:us-east-1:123456789:notifications',
 *     Message: message,
 *     Subject: subject
 *   }));
 *
 *   if (result.MessageId) {
 *     ctx.setAttribute('messaging.message.id', result.MessageId);
 *   }
 *
 *   return result;
 * });
 *
 * // Usage: await publishNotification('User signed up', 'New User');
 * ```
 *
 * @example Publish to mobile endpoint
 * ```typescript
 * export const sendPushNotification = traceSNS({
 *   operation: 'publish',
 *   topicArn: 'arn:aws:sns:us-east-1:123456789:app/APNS/my-app'
 * })(ctx => async (endpointArn: string, payload: object) => {
 *   ctx.setAttribute('aws.sns.target_arn', endpointArn);
 *   return await sns.send(new PublishCommand({
 *     TargetArn: endpointArn,
 *     Message: JSON.stringify(payload),
 *     MessageStructure: 'json'
 *   }));
 * });
 * ```
 */

import { trace, type TraceContext } from 'autotel';
import { context, propagation, SpanStatusCode } from '@opentelemetry/api';
import { buildSNSAttributes } from '../attributes';
import { wrapSDKClient } from '../common/sdk-wrapper';

/**
 * SNS operation configuration
 */
export interface TraceSNSConfig {
  /**
   * SNS topic ARN
   * Sets `messaging.destination.name` attribute.
   */
  topicArn: string;

  /**
   * Operation type (defaults to 'publish')
   */
  operation?: 'publish' | 'subscribe' | 'unsubscribe';
}

/**
 * Trace SNS operations with semantic attributes
 *
 * Creates a traced function that automatically sets SNS messaging semantic attributes
 * following OpenTelemetry conventions.
 *
 * @param config - SNS operation configuration
 * @returns A higher-order function that wraps your SNS operation with tracing
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `messaging.system` - 'aws_sns'
 * - `messaging.destination.name` - Topic ARN
 * - `messaging.operation` - 'publish'
 *
 * Additional attributes you should set in your handler:
 * - `messaging.message.id` - Message ID from response
 * - `aws.sns.target_arn` - Target ARN for direct publishing
 *
 * @see https://opentelemetry.io/docs/specs/semconv/messaging/aws-sns/
 */
export function traceSNS(config: TraceSNSConfig) {
  const operation = config.operation ?? 'publish';

  return function wrapper<TArgs extends unknown[], TReturn>(
    fn: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    // Use autotel's trace() which properly handles the factory pattern
    return trace(
      `sns.${operation}`,
      (ctx: TraceContext) =>
        async (...args: TArgs): Promise<TReturn> => {
          // Set SNS semantic attributes
          ctx.setAttributes(buildSNSAttributes({ topicArn: config.topicArn }));

          // Get the user's handler and execute with forwarded arguments
          const handler = fn(ctx);
          return handler(...args);
        },
    );
  };
}

// ============================================================================
// SNS Publisher - Publishes messages with automatic trace context injection
// ============================================================================

/**
 * Configuration for SNS Publisher
 */
export interface SNSPublisherConfig {
  /**
   * SNS Topic ARN
   */
  topicArn: string;

  /**
   * Inject W3C Trace Context into message attributes
   * Enables distributed tracing to SNS subscribers (e.g., Lambda, SQS)
   * @default true
   */
  injectTraceContext?: boolean;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Message to publish via SNS Publisher
 */
export interface SNSPublishMessage {
  /**
   * Message body (string or JSON for message structure)
   */
  message: string;

  /**
   * Optional subject (for email/SMS subscriptions)
   */
  subject?: string;

  /**
   * Optional message attributes
   */
  attributes?: Record<string, { StringValue: string; DataType: string }>;

  /**
   * Optional target ARN for direct endpoint publishing
   */
  targetArn?: string;

  /**
   * Optional phone number for SMS
   */
  phoneNumber?: string;

  /**
   * Optional message structure ('json' for platform-specific messages)
   */
  messageStructure?: 'json';

  /**
   * Optional message group ID (for FIFO topics)
   */
  messageGroupId?: string;

  /**
   * Optional deduplication ID (for FIFO topics)
   */
  messageDeduplicationId?: string;
}

/**
 * SNS Publisher with automatic trace context injection
 *
 * Wraps an SNS client to automatically:
 * - Create spans for publish operations
 * - Inject W3C Trace Context into message attributes
 * - Set proper semantic attributes
 *
 * @example Basic usage
 * ```typescript
 * import { SNSPublisher } from 'autotel-aws/sns';
 * import { SNSClient } from '@aws-sdk/client-sns';
 *
 * const sns = new SNSClient({ region: 'us-east-1' });
 * const publisher = new SNSPublisher(sns, {
 *   topicArn: 'arn:aws:sns:us-east-1:123456789:my-topic'
 * });
 *
 * // Publish with automatic trace context
 * const result = await publisher.publish({
 *   message: 'Order completed',
 *   subject: 'Order #12345'
 * });
 * console.log('Message ID:', result.messageId);
 * ```
 *
 * @example With custom attributes
 * ```typescript
 * await publisher.publish({
 *   message: JSON.stringify({ orderId: '12345', status: 'completed' }),
 *   attributes: {
 *     'eventType': { StringValue: 'ORDER_COMPLETED', DataType: 'String' },
 *     'priority': { StringValue: 'high', DataType: 'String' }
 *   }
 * });
 * ```
 *
 * @example Batch publish
 * ```typescript
 * const results = await publisher.publishBatch([
 *   { message: 'Event 1' },
 *   { message: 'Event 2' },
 *   { message: 'Event 3' }
 * ]);
 * console.log(`Published ${results.successful.length} messages`);
 * ```
 *
 * @example Direct endpoint publish
 * ```typescript
 * await publisher.publishToEndpoint({
 *   targetArn: 'arn:aws:sns:us-east-1:123456789:endpoint/APNS/my-app/device-token',
 *   message: JSON.stringify({
 *     APNS: JSON.stringify({ aps: { alert: 'Hello!' } })
 *   }),
 *   messageStructure: 'json'
 * });
 * ```
 */
export class SNSPublisher<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<Pick<SNSPublisherConfig, 'topicArn'>> & SNSPublisherConfig;
  private topicName: string;

  constructor(client: TClient, config: SNSPublisherConfig) {
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      injectTraceContext: true,
      ...config,
    };
    // Extract topic name from ARN (last segment)
    this.topicName = config.topicArn.split(':').pop() || 'unknown';
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
   * Publish a message to the topic
   *
   * @param message - Message to publish
   * @returns Promise with message ID and sequence number
   */
  async publish(message: SNSPublishMessage): Promise<{
    messageId?: string;
    sequenceNumber?: string;
  }> {
    return trace(`sns.publish`, async (ctx: TraceContext) => {
      ctx.setAttributes(buildSNSAttributes({ topicArn: this.config.topicArn }));
      ctx.setAttribute('messaging.destination.name', this.topicName);

      const input = {
        TopicArn: message.targetArn ? undefined : this.config.topicArn,
        TargetArn: message.targetArn,
        PhoneNumber: message.phoneNumber,
        Message: message.message,
        Subject: message.subject,
        MessageAttributes: this.injectContext(message.attributes),
        MessageStructure: message.messageStructure,
        ...(message.messageGroupId && { MessageGroupId: message.messageGroupId }),
        ...(message.messageDeduplicationId && {
          MessageDeduplicationId: message.messageDeduplicationId,
        }),
      };

      try {
        const { PublishCommand } = await import('@aws-sdk/client-sns');
        const result = await this.client.send(new PublishCommand(input));

        if (result.MessageId) {
          ctx.setAttribute('messaging.message.id', result.MessageId);
        }

        ctx.setStatus({ code: SpanStatusCode.OK });

        return {
          messageId: result.MessageId,
          sequenceNumber: result.SequenceNumber,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Publish failed',
        });
        throw error;
      }
    });
  }

  /**
   * Publish multiple messages in a batch
   *
   * @param messages - Array of messages to publish (max 10)
   * @returns Promise with successful and failed message results
   */
  async publishBatch(messages: SNSPublishMessage[]): Promise<{
    successful: Array<{ id: string; messageId?: string; sequenceNumber?: string }>;
    failed: Array<{ id: string; code?: string; message?: string }>;
  }> {
    return trace(`sns.publishBatch`, async (ctx: TraceContext) => {
      ctx.setAttributes(buildSNSAttributes({ topicArn: this.config.topicArn }));
      ctx.setAttribute('messaging.batch.message_count', messages.length);

      const entries = messages.map((msg, index) => ({
        Id: String(index),
        Message: msg.message,
        Subject: msg.subject,
        MessageAttributes: this.injectContext(msg.attributes),
        MessageStructure: msg.messageStructure,
        ...(msg.messageGroupId && { MessageGroupId: msg.messageGroupId }),
        ...(msg.messageDeduplicationId && {
          MessageDeduplicationId: msg.messageDeduplicationId,
        }),
      }));

      try {
        const { PublishBatchCommand } = await import('@aws-sdk/client-sns');
        const result = await this.client.send(
          new PublishBatchCommand({
            TopicArn: this.config.topicArn,
            PublishBatchRequestEntries: entries,
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

        ctx.setAttribute('messaging.sns.successful_count', successful.length);
        ctx.setAttribute('messaging.sns.failed_count', failed.length);

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
          message: error instanceof Error ? error.message : 'Batch publish failed',
        });
        throw error;
      }
    });
  }

  /**
   * Publish to a specific endpoint (mobile push, etc.)
   *
   * @param message - Message with targetArn set
   * @returns Promise with message ID
   */
  async publishToEndpoint(
    message: Omit<SNSPublishMessage, 'targetArn'> & { targetArn: string },
  ): Promise<{ messageId?: string }> {
    return trace(`sns.publishToEndpoint`, async (ctx: TraceContext) => {
      ctx.setAttribute('messaging.system', 'aws_sns');
      ctx.setAttribute('aws.sns.target_arn', message.targetArn);

      const input = {
        TargetArn: message.targetArn,
        Message: message.message,
        Subject: message.subject,
        MessageAttributes: this.injectContext(message.attributes),
        MessageStructure: message.messageStructure,
      };

      try {
        const { PublishCommand } = await import('@aws-sdk/client-sns');
        const result = await this.client.send(new PublishCommand(input));

        if (result.MessageId) {
          ctx.setAttribute('messaging.message.id', result.MessageId);
        }

        ctx.setStatus({ code: SpanStatusCode.OK });

        return { messageId: result.MessageId };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Endpoint publish failed',
        });
        throw error;
      }
    });
  }
}
