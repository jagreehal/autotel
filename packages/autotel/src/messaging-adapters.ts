/**
 * Pre-built adapter configurations for common messaging systems.
 *
 * These adapters provide ready-to-use hook configurations for systems
 * not explicitly supported by the core messaging module. Use them with
 * traceProducer/traceConsumer to get system-specific attributes.
 *
 * @example NATS consumer
 * ```typescript
 * import { traceConsumer } from 'autotel/messaging';
 * import { natsAdapter } from 'autotel/messaging/adapters';
 *
 * const processMessage = traceConsumer({
 *   system: 'nats',
 *   destination: 'orders',
 *   ...natsAdapter.consumer,
 * })(ctx => async (msg) => {
 *   // msg.subject, msg.info.stream are now captured as span attributes
 *   await handleOrder(msg.data);
 * });
 * ```
 *
 * @example Datadog context propagation
 * ```typescript
 * import { traceConsumer } from 'autotel/messaging';
 * import { datadogContextExtractor } from 'autotel/messaging/adapters';
 *
 * const processMessage = traceConsumer({
 *   system: 'kafka',
 *   destination: 'events',
 *   customContextExtractor: datadogContextExtractor,
 * })(ctx => async (msg) => {
 *   // Parent span from Datadog trace headers is linked
 * });
 * ```
 *
 * @module
 */

import type { AttributeValue, SpanContext } from '@opentelemetry/api';
import { TraceFlags } from '@opentelemetry/api';
import type { ProducerContext, ConsumerContext } from './messaging';

// ============================================================================
// Adapter Types
// ============================================================================

/**
 * Producer adapter configuration
 */
export interface ProducerAdapter {
  /**
   * Hook to add system-specific attributes to producer spans
   */
  customAttributes?: (
    ctx: ProducerContext,
    args: unknown[],
  ) => Record<string, AttributeValue>;

  /**
   * Hook to inject custom headers beyond W3C traceparent
   */
  customHeaders?: (ctx: ProducerContext) => Record<string, string>;
}

/**
 * Consumer adapter configuration
 */
export interface ConsumerAdapter {
  /**
   * Extract headers from the message for trace context propagation
   */
  headersFrom?: (msg: unknown) => Record<string, string> | undefined;

  /**
   * Hook to add system-specific attributes to consumer spans
   */
  customAttributes?: (
    ctx: ConsumerContext,
    msg: unknown,
  ) => Record<string, AttributeValue>;

  /**
   * Hook to extract parent span context from non-W3C header formats
   */
  customContextExtractor?: (
    headers: Record<string, string>,
  ) => SpanContext | null;
}

/**
 * Combined producer and consumer adapter
 */
export interface MessagingAdapter {
  producer?: ProducerAdapter;
  consumer?: ConsumerAdapter;
}

// ============================================================================
// NATS JetStream Adapter
// ============================================================================

/**
 * NATS JetStream message type (for reference)
 *
 * @internal Not exported - users bring their own NATS types
 */
interface NatsJetStreamMsg {
  subject: string;
  reply?: string;
  data: Uint8Array;
  headers?: {
    /** Convert headers to plain object (some NATS implementations) */
    toJSON?: () => Record<string, string> | unknown;
    /** Get a header value by key (Headers-like interface) */
    get?: (key: string) => string | undefined;
    /** Iterate over header entries */
    entries?: () => Iterable<[string, string]>;
  };
  info?: {
    stream: string;
    consumer: string;
    redeliveryCount?: number;
    pending?: number;
    timestampNanos?: bigint;
  };
}

/**
 * NATS JetStream adapter
 *
 * Captures NATS-specific attributes following NATS observability conventions.
 *
 * @example Producer
 * ```typescript
 * const publishOrder = traceProducer({
 *   system: 'nats',
 *   destination: 'orders.created',
 *   ...natsAdapter.producer,
 * })(ctx => async (subject, payload, opts) => {
 *   const headers = ctx.getTraceHeaders();
 *   await nc.publish(subject, payload, { headers });
 * });
 * ```
 *
 * @example Consumer
 * ```typescript
 * const processOrder = traceConsumer({
 *   system: 'nats',
 *   destination: 'orders.created',
 *   consumerGroup: 'order-processor',
 *   ...natsAdapter.consumer,
 * })(ctx => async (msg: JsMsg) => {
 *   await handleOrder(msg.data);
 *   msg.ack();
 * });
 * ```
 */
export const natsAdapter: MessagingAdapter = {
  producer: {
    customAttributes: (_ctx, args) => {
      const msg = args[0] as
        | { subject?: string; replyTo?: string; stream?: string }
        | undefined;
      const attrs: Record<string, AttributeValue> = {};

      if (msg?.subject) attrs['nats.subject'] = msg.subject;
      if (msg?.replyTo) attrs['nats.reply_to'] = msg.replyTo;
      if (msg?.stream) attrs['nats.stream'] = msg.stream;

      return attrs;
    },
  },
  consumer: {
    headersFrom: (msg) => {
      const natsMsg = msg as NatsJetStreamMsg;
      const headers = natsMsg.headers;

      if (!headers) return;

      // Try toJSON() first (some NATS implementations)
      if (typeof headers.toJSON === 'function') {
        const json = headers.toJSON();
        if (json && typeof json === 'object') {
          return json as Record<string, string>;
        }
      }

      // Fallback: use .get() for common trace headers
      // This handles Headers-like objects that only expose .get()
      if (typeof headers.get === 'function') {
        const result: Record<string, string> = {};
        const traceHeaders = [
          'traceparent',
          'tracestate',
          'baggage',
          'x-b3-traceid',
          'x-b3-spanid',
          'x-b3-sampled',
          'b3',
        ];
        for (const key of traceHeaders) {
          const value = headers.get(key);
          if (value) {
            result[key] = value;
          }
        }
        if (Object.keys(result).length > 0) {
          return result;
        }
      }

      // Fallback: try to iterate if it's iterable (e.g., entries())
      if (typeof headers.entries === 'function') {
        const result: Record<string, string> = {};
        for (const [key, value] of headers.entries()) {
          if (typeof key === 'string' && typeof value === 'string') {
            result[key] = value;
          }
        }
        if (Object.keys(result).length > 0) {
          return result;
        }
      }

      return;
    },
    customAttributes: (_ctx, msg) => {
      const natsMsg = msg as NatsJetStreamMsg;
      const attrs: Record<string, AttributeValue> = {};

      if (natsMsg.subject) attrs['nats.subject'] = natsMsg.subject;
      if (natsMsg.reply) attrs['nats.reply_to'] = natsMsg.reply;
      if (natsMsg.info?.stream) attrs['nats.stream'] = natsMsg.info.stream;
      if (natsMsg.info?.consumer)
        attrs['nats.consumer'] = natsMsg.info.consumer;
      if (natsMsg.info?.redeliveryCount !== undefined) {
        attrs['nats.delivered_count'] = natsMsg.info.redeliveryCount;
      }
      if (natsMsg.info?.pending !== undefined) {
        attrs['nats.pending'] = natsMsg.info.pending;
      }

      return attrs;
    },
  },
};

// ============================================================================
// Temporal Adapter
// ============================================================================

/**
 * Temporal activity/workflow info type (for reference)
 *
 * @internal Not exported - users bring their own Temporal types
 */
interface TemporalActivityInfo {
  workflowId?: string;
  runId?: string;
  activityId?: string;
  taskQueue?: string;
  attempt?: number;
  workflowType?: string;
  activityType?: string;
  startToCloseTimeout?: string;
  scheduleToCloseTimeout?: string;
}

/**
 * Temporal adapter
 *
 * Captures Temporal-specific attributes for workflow activities.
 * Use this when instrumenting Temporal activity handlers.
 *
 * @example Activity handler
 * ```typescript
 * const processOrder = traceConsumer({
 *   system: 'temporal',
 *   destination: 'order-activities',
 *   ...temporalAdapter.consumer,
 * })(ctx => async (info: ActivityInfo, input: OrderInput) => {
 *   // Temporal attributes are captured automatically
 *   return processOrderLogic(input);
 * });
 * ```
 *
 * @example Workflow signal/query
 * ```typescript
 * const sendSignal = traceProducer({
 *   system: 'temporal',
 *   destination: 'order-signals',
 *   ...temporalAdapter.producer,
 * })(ctx => async (workflowId, signalName, payload) => {
 *   await client.workflow.signal(workflowId, signalName, payload);
 * });
 * ```
 */
export const temporalAdapter: MessagingAdapter = {
  producer: {
    customAttributes: (_ctx, args) => {
      const info = args[0] as TemporalActivityInfo | undefined;
      const attrs: Record<string, AttributeValue> = {};

      if (info?.workflowId) attrs['temporal.workflow_id'] = info.workflowId;
      if (info?.runId) attrs['temporal.run_id'] = info.runId;
      if (info?.taskQueue) attrs['temporal.task_queue'] = info.taskQueue;
      if (info?.workflowType)
        attrs['temporal.workflow_type'] = info.workflowType;

      return attrs;
    },
  },
  consumer: {
    customAttributes: (_ctx, msg) => {
      const info = msg as TemporalActivityInfo;
      const attrs: Record<string, AttributeValue> = {};

      if (info.workflowId) attrs['temporal.workflow_id'] = info.workflowId;
      if (info.runId) attrs['temporal.run_id'] = info.runId;
      if (info.activityId) attrs['temporal.activity_id'] = info.activityId;
      if (info.taskQueue) attrs['temporal.task_queue'] = info.taskQueue;
      if (info.attempt !== undefined) attrs['temporal.attempt'] = info.attempt;
      if (info.activityType)
        attrs['temporal.activity_type'] = info.activityType;

      return attrs;
    },
  },
};

// ============================================================================
// Cloudflare Queues Adapter
// ============================================================================

/**
 * Cloudflare Queue message type (for reference)
 *
 * @internal Not exported - users bring their own Cloudflare types
 */
interface CloudflareQueueMessage {
  id: string;
  timestamp: Date;
  body: unknown;
  attempts: number;
}

/**
 * Cloudflare Queues adapter
 *
 * Captures Cloudflare Queue-specific attributes.
 *
 * @example Queue consumer
 * ```typescript
 * export default {
 *   async queue(batch: MessageBatch, env: Env) {
 *     for (const msg of batch.messages) {
 *       await processMessage(msg);
 *     }
 *   },
 * };
 *
 * const processMessage = traceConsumer({
 *   system: 'cloudflare_queues',
 *   destination: 'my-queue',
 *   ...cloudflareQueuesAdapter.consumer,
 * })(ctx => async (msg: Message) => {
 *   await handleMessage(msg.body);
 *   msg.ack();
 * });
 * ```
 */
export const cloudflareQueuesAdapter: MessagingAdapter = {
  consumer: {
    customAttributes: (_ctx, msg) => {
      const cfMsg = msg as CloudflareQueueMessage;
      const attrs: Record<string, AttributeValue> = {};

      if (cfMsg.id) attrs['cloudflare.queue.message_id'] = cfMsg.id;
      if (cfMsg.timestamp) {
        attrs['cloudflare.queue.timestamp_ms'] = cfMsg.timestamp.getTime();
      }
      if (cfMsg.attempts !== undefined) {
        attrs['cloudflare.queue.attempts'] = cfMsg.attempts;
      }

      return attrs;
    },
  },
};

// ============================================================================
// Context Extractors for Non-W3C Formats
// ============================================================================

/**
 * Datadog trace context extractor
 *
 * Extracts parent span context from Datadog-format trace headers.
 * Converts Datadog's decimal IDs to OpenTelemetry's hex format.
 *
 * Note: Datadog sends trace/span IDs as decimal strings, not hex.
 * This extractor converts decimal -> hex before formatting for OTel.
 *
 * @example
 * ```typescript
 * const processMessage = traceConsumer({
 *   system: 'kafka',
 *   destination: 'events',
 *   customContextExtractor: datadogContextExtractor,
 * })(ctx => async (msg) => {
 *   // Links to parent Datadog span automatically
 * });
 * ```
 */
export function datadogContextExtractor(
  headers: Record<string, string>,
): SpanContext | null {
  const traceIdDecimal = headers['x-datadog-trace-id'];
  const spanIdDecimal = headers['x-datadog-parent-id'];
  const samplingPriority = headers['x-datadog-sampling-priority'];

  if (!traceIdDecimal || !spanIdDecimal) return null;

  // Datadog sends IDs as decimal strings - convert to hex
  // Use BigInt for 64-bit values that exceed Number.MAX_SAFE_INTEGER
  let otelTraceId: string;
  let otelSpanId: string;

  try {
    // Convert decimal to hex and pad to OTel format
    // OTel trace IDs are 32 hex chars (128-bit), Datadog uses 64-bit
    otelTraceId = BigInt(traceIdDecimal).toString(16).padStart(32, '0');
    // OTel span IDs are 16 hex chars (64-bit)
    otelSpanId = BigInt(spanIdDecimal).toString(16).padStart(16, '0');
  } catch {
    // Invalid decimal string
    return null;
  }

  // Sampling priority > 0 means sampled
  const sampled = samplingPriority
    ? Number.parseInt(samplingPriority, 10) > 0
    : true;

  return {
    traceId: otelTraceId,
    spanId: otelSpanId,
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
}

/**
 * B3 (Zipkin) trace context extractor
 *
 * Extracts parent span context from B3 format headers.
 * Supports both single-header (b3) and multi-header formats.
 *
 * @see https://github.com/openzipkin/b3-propagation
 *
 * @example Single-header format
 * ```typescript
 * // Header: b3: 80f198ee56343ba864fe8b2a57d3eff7-e457b5a2e4d86bd1-1
 * const processMessage = traceConsumer({
 *   system: 'rabbitmq',
 *   destination: 'events',
 *   customContextExtractor: b3ContextExtractor,
 * })(ctx => async (msg) => {
 *   // Links to parent Zipkin span
 * });
 * ```
 *
 * @example Multi-header format
 * ```typescript
 * // Headers: X-B3-TraceId, X-B3-SpanId, X-B3-Sampled
 * ```
 */
export function b3ContextExtractor(
  headers: Record<string, string>,
): SpanContext | null {
  // Try single-header format first: {TraceId}-{SpanId}-{SamplingState}-{ParentSpanId}
  const b3Single = headers['b3'] || headers['B3'];
  if (b3Single) {
    // Handle "0" (not sampled, no trace) case
    if (b3Single === '0') return null;

    const parts = b3Single.split('-');
    const traceId = parts[0];
    const spanId = parts[1];
    const sampledFlag = parts[2];

    if (traceId && spanId) {
      const sampled = sampledFlag !== '0' && sampledFlag !== 'd';

      return {
        traceId: traceId.padStart(32, '0'),
        spanId: spanId.padStart(16, '0'),
        traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
        isRemote: true,
      };
    }
  }

  // Fall back to multi-header format
  const traceId =
    headers['x-b3-traceid'] ||
    headers['X-B3-TraceId'] ||
    headers['X-B3-Traceid'];
  const spanId =
    headers['x-b3-spanid'] || headers['X-B3-SpanId'] || headers['X-B3-Spanid'];
  const sampledHeader =
    headers['x-b3-sampled'] ||
    headers['X-B3-Sampled'] ||
    headers['x-b3-flags'] ||
    headers['X-B3-Flags'];

  if (!traceId || !spanId) return null;

  // x-b3-sampled: "1" or "true" = sampled, "0" or "false" = not sampled
  // x-b3-flags: "1" = debug (implies sampled)
  const sampled =
    sampledHeader === '1' ||
    sampledHeader === 'true' ||
    sampledHeader === undefined; // Default to sampled if not specified

  return {
    traceId: traceId.padStart(32, '0'),
    spanId: spanId.padStart(16, '0'),
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
}

/**
 * AWS X-Ray trace context extractor
 *
 * Extracts parent span context from AWS X-Ray trace header.
 * Format: Root=1-{timestamp}-{random};Parent={parent-id};Sampled={0|1}
 *
 * @example
 * ```typescript
 * const processMessage = traceConsumer({
 *   system: 'sqs',
 *   destination: 'my-queue',
 *   customContextExtractor: xrayContextExtractor,
 * })(ctx => async (msg) => {
 *   // Links to parent X-Ray trace
 * });
 * ```
 */
export function xrayContextExtractor(
  headers: Record<string, string>,
): SpanContext | null {
  const xrayHeader = headers['x-amzn-trace-id'] || headers['X-Amzn-Trace-Id'];

  if (!xrayHeader) return null;

  // Parse: Root=1-{8-char-timestamp}-{24-char-random};Parent={16-char-parent};Sampled=1
  const rootMatch = xrayHeader.match(/Root=1-([a-f0-9]{8})-([a-f0-9]{24})/i);
  const parentMatch = xrayHeader.match(/Parent=([a-f0-9]{16})/i);
  const sampledMatch = xrayHeader.match(/Sampled=([01])/);

  if (!rootMatch || !parentMatch) return null;

  // X-Ray trace ID format: 1-{timestamp}-{random} -> OTel: {timestamp}{random}
  const timestamp = rootMatch[1];
  const random = rootMatch[2];
  const parentId = parentMatch[1];

  if (!timestamp || !random || !parentId) return null;

  const traceId = `${timestamp}${random}`;
  const spanId = parentId;
  const sampled = sampledMatch ? sampledMatch[1] === '1' : true;

  return {
    traceId,
    spanId,
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
}
