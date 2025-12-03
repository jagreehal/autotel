/**
 * EventBridge instrumentation
 *
 * Provides helpers for tracing Amazon EventBridge operations with
 * automatic W3C Trace Context propagation for distributed tracing.
 *
 * @example Publish events with trace context
 * ```typescript
 * import { EventBridgePublisher } from 'autotel-aws/eventbridge';
 * import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
 *
 * const client = new EventBridgeClient({ region: 'us-east-1' });
 * const publisher = new EventBridgePublisher(client, {
 *   eventBusName: 'my-event-bus',
 *   source: 'com.myapp.orders'
 * });
 *
 * // Publish with automatic trace context injection
 * await publisher.putEvent({
 *   detailType: 'OrderCreated',
 *   detail: { orderId: '123', customerId: 'abc' }
 * });
 * ```
 *
 * @example Extract context in Lambda triggered by EventBridge
 * ```typescript
 * import { extractEventBridgeContext } from 'autotel-aws/eventbridge';
 * import { wrapHandler } from 'autotel-aws/lambda';
 *
 * export const handler = wrapHandler(async (event) => {
 *   // Extract trace context from EventBridge event detail
 *   const parentContext = extractEventBridgeContext(event);
 *
 *   // Process the event
 *   const { orderId, customerId } = event.detail;
 *   await processOrder(orderId, customerId);
 *
 *   return { statusCode: 200 };
 * });
 * ```
 *
 * @example Trace EventBridge operations with helper
 * ```typescript
 * import { traceEventBridge } from 'autotel-aws/eventbridge';
 *
 * export const publishOrderEvent = traceEventBridge({
 *   eventBus: 'orders-bus',
 *   source: 'order-service',
 *   detailType: 'OrderCreated'
 * })(ctx => async (order: Order) => {
 *   ctx.setAttribute('order.id', order.id);
 *   await eventBridge.send(new PutEventsCommand({
 *     Entries: [{
 *       EventBusName: 'orders-bus',
 *       Source: 'order-service',
 *       DetailType: 'OrderCreated',
 *       Detail: JSON.stringify(injectEventBridgeContext(order))
 *     }]
 *   }));
 * });
 * ```
 */

import { trace, type TraceContext } from 'autotel';
import { context, propagation, SpanStatusCode } from '@opentelemetry/api';
import type { SpanContext } from '@opentelemetry/api';
import { buildEventBridgeAttributes } from '../attributes';
import { wrapSDKClient } from '../common/sdk-wrapper';

// ============================================================================
// Types
// ============================================================================

/**
 * EventBridge operation configuration for traceEventBridge helper
 */
export interface TraceEventBridgeConfig {
  /**
   * Event bus name or ARN
   */
  eventBus: string;

  /**
   * Event source (e.g., 'com.myapp.orders')
   */
  source: string;

  /**
   * Event detail type (e.g., 'OrderCreated')
   */
  detailType: string;
}

/**
 * Configuration for EventBridgePublisher
 */
export interface EventBridgePublisherConfig {
  /**
   * Event bus name or ARN
   * @default 'default' (the account's default event bus)
   */
  eventBusName?: string;

  /**
   * Event source (e.g., 'com.myapp.orders')
   */
  source: string;

  /**
   * Inject W3C Trace Context into event detail
   * @default true
   */
  injectTraceContext?: boolean;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Event to publish via EventBridgePublisher
 */
export interface EventBridgeEvent<T = Record<string, unknown>> {
  /**
   * Event detail type (e.g., 'OrderCreated', 'UserSignedUp')
   */
  detailType: string;

  /**
   * Event detail (the actual payload)
   */
  detail: T;

  /**
   * Optional resources ARNs associated with the event
   */
  resources?: string[];

  /**
   * Optional time for the event (defaults to current time)
   */
  time?: Date;

  /**
   * Optional trace header (for X-Ray integration)
   */
  traceHeader?: string;
}

/**
 * Trace context fields injected into EventBridge detail
 */
interface TraceContextFields {
  _traceContext?: {
    traceparent: string;
    tracestate?: string;
    baggage?: string;
  };
}

/**
 * EventBridge event structure (Lambda event format)
 */
export interface EventBridgeLambdaEvent {
  version?: string;
  id?: string;
  'detail-type'?: string;
  source?: string;
  account?: string;
  time?: string;
  region?: string;
  resources?: string[];
  detail?: Record<string, unknown> & TraceContextFields;
}

// ============================================================================
// Context Propagation Helpers
// ============================================================================

/**
 * Inject W3C Trace Context into EventBridge event detail
 *
 * Adds `_traceContext` field with traceparent, tracestate, and baggage.
 * This enables distributed tracing from the publisher to all event consumers.
 *
 * @param detail - The event detail object
 * @returns Detail with trace context injected
 *
 * @example
 * ```typescript
 * const detail = { orderId: '123', status: 'created' };
 * const detailWithContext = injectEventBridgeContext(detail);
 * // { orderId: '123', status: 'created', _traceContext: { traceparent: '...' } }
 *
 * await eventBridge.send(new PutEventsCommand({
 *   Entries: [{
 *     EventBusName: 'my-bus',
 *     Source: 'my-app',
 *     DetailType: 'OrderCreated',
 *     Detail: JSON.stringify(detailWithContext)
 *   }]
 * }));
 * ```
 */
export function injectEventBridgeContext<T extends Record<string, unknown>>(
  detail: T,
): T & TraceContextFields {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  if (!carrier.traceparent) {
    return detail;
  }

  return {
    ...detail,
    _traceContext: {
      traceparent: carrier.traceparent,
      ...(carrier.tracestate && { tracestate: carrier.tracestate }),
      ...(carrier.baggage && { baggage: carrier.baggage }),
    },
  };
}

/**
 * Extract W3C Trace Context from EventBridge Lambda event
 *
 * Extracts the `_traceContext` field from the event detail.
 * Works with the Lambda event format from EventBridge rules.
 *
 * @param event - EventBridge Lambda event
 * @returns SpanContext if trace context was found, undefined otherwise
 *
 * @example
 * ```typescript
 * // In a Lambda triggered by EventBridge
 * export const handler = async (event: EventBridgeLambdaEvent) => {
 *   const parentContext = extractEventBridgeContext(event);
 *   // Use parentContext to link traces...
 *
 *   // Access detail without trace context
 *   const cleanDetail = stripEventBridgeContext(event.detail);
 * };
 * ```
 */
export function extractEventBridgeContext(
  event: EventBridgeLambdaEvent,
): SpanContext | undefined {
  if (!event.detail || typeof event.detail !== 'object') {
    return undefined;
  }

  const traceContext = event.detail._traceContext;
  if (!traceContext?.traceparent) {
    return undefined;
  }

  // Use W3C Trace Context propagator to extract
  const carrier: Record<string, string> = {
    traceparent: traceContext.traceparent,
    ...(traceContext.tracestate && { tracestate: traceContext.tracestate }),
    ...(traceContext.baggage && { baggage: traceContext.baggage }),
  };

  const extractedContext = propagation.extract(context.active(), carrier);
  const span = extractedContext.getValue(Symbol.for('OpenTelemetry Context Key SPAN'));

  // Handle both Span and SpanContext
  if (span && typeof span === 'object') {
    if ('spanContext' in span && typeof span.spanContext === 'function') {
      return span.spanContext() as SpanContext;
    }
    // Might already be a SpanContext
    if ('traceId' in span && 'spanId' in span) {
      return span as SpanContext;
    }
  }

  return undefined;
}

/**
 * Strip trace context fields from EventBridge event detail
 *
 * Returns the detail without `_traceContext` field for cleaner processing.
 *
 * @param detail - EventBridge event detail with optional trace context
 * @returns Detail without trace context fields
 *
 * @example
 * ```typescript
 * const detail = { orderId: '123', _traceContext: { ... } };
 * const cleanDetail = stripEventBridgeContext(detail);
 * // { orderId: '123' }
 * ```
 */
export function stripEventBridgeContext<T extends Record<string, unknown>>(
  detail: T,
): Omit<T, '_traceContext'> {
  const { _traceContext: _, ...rest } = detail as T & TraceContextFields;
  return rest as Omit<T, '_traceContext'>;
}

// ============================================================================
// Trace Helper (Original API)
// ============================================================================

/**
 * Trace EventBridge operations with semantic attributes
 *
 * Creates a traced function that automatically sets EventBridge attributes.
 *
 * @param config - EventBridge operation configuration
 * @returns A higher-order function that wraps your EventBridge operation with tracing
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `aws.eventbridge.event_bus` - Event bus name
 * - `aws.eventbridge.source` - Event source
 * - `aws.eventbridge.detail_type` - Event detail type
 *
 * @example
 * ```typescript
 * export const publishOrderEvent = traceEventBridge({
 *   eventBus: 'orders-bus',
 *   source: 'order-service',
 *   detailType: 'OrderCreated'
 * })(ctx => async (order: Order) => {
 *   ctx.setAttribute('order.id', order.id);
 *
 *   const detail = injectEventBridgeContext(order);
 *   await eventBridge.send(new PutEventsCommand({
 *     Entries: [{
 *       EventBusName: 'orders-bus',
 *       Source: 'order-service',
 *       DetailType: 'OrderCreated',
 *       Detail: JSON.stringify(detail)
 *     }]
 *   }));
 * });
 * ```
 */
export function traceEventBridge(config: TraceEventBridgeConfig) {
  return function wrapper<TArgs extends unknown[], TReturn>(
    fn: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    // Use autotel's trace() which properly handles the factory pattern
    return trace(
      `eventbridge.${config.detailType}`,
      (ctx: TraceContext) =>
        async (...args: TArgs): Promise<TReturn> => {
          // Set EventBridge semantic attributes
          ctx.setAttributes(
            buildEventBridgeAttributes({
              eventBus: config.eventBus,
              source: config.source,
              detailType: config.detailType,
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
// EventBridgePublisher Class
// ============================================================================

/**
 * EventBridge Publisher with automatic trace context injection
 *
 * Wraps an EventBridge client to automatically:
 * - Create spans for PutEvents operations
 * - Inject W3C Trace Context into event detail
 * - Set proper semantic attributes
 *
 * @example Basic usage
 * ```typescript
 * import { EventBridgePublisher } from 'autotel-aws/eventbridge';
 * import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
 *
 * const client = new EventBridgeClient({ region: 'us-east-1' });
 * const publisher = new EventBridgePublisher(client, {
 *   eventBusName: 'my-event-bus',
 *   source: 'com.myapp.orders'
 * });
 *
 * // Publish single event
 * const result = await publisher.putEvent({
 *   detailType: 'OrderCreated',
 *   detail: { orderId: '123', customerId: 'abc' }
 * });
 * console.log('Event ID:', result.eventId);
 * ```
 *
 * @example Batch publish multiple events
 * ```typescript
 * const results = await publisher.putEvents([
 *   { detailType: 'OrderCreated', detail: { orderId: '1' } },
 *   { detailType: 'OrderCreated', detail: { orderId: '2' } },
 *   { detailType: 'OrderCreated', detail: { orderId: '3' } }
 * ]);
 *
 * console.log(`Published ${results.successful.length} events`);
 * console.log(`Failed ${results.failed.length} events`);
 * ```
 *
 * @example Multiple sources
 * ```typescript
 * // Create publishers for different event sources
 * const ordersPublisher = new EventBridgePublisher(client, {
 *   source: 'com.myapp.orders'
 * });
 *
 * const usersPublisher = new EventBridgePublisher(client, {
 *   source: 'com.myapp.users'
 * });
 *
 * await ordersPublisher.putEvent({ detailType: 'OrderCreated', detail: {...} });
 * await usersPublisher.putEvent({ detailType: 'UserSignedUp', detail: {...} });
 * ```
 */
export class EventBridgePublisher<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<Pick<EventBridgePublisherConfig, 'source'>> &
    EventBridgePublisherConfig;

  constructor(client: TClient, config: EventBridgePublisherConfig) {
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      eventBusName: 'default',
      injectTraceContext: true,
      ...config,
    };
  }

  /**
   * Publish a single event to EventBridge
   *
   * @param event - Event to publish
   * @returns Promise with event ID (if successful)
   */
  async putEvent<T extends Record<string, unknown>>(
    event: EventBridgeEvent<T>,
  ): Promise<{
    eventId?: string;
    failedEntryCount?: number;
  }> {
    return trace(`eventbridge.PutEvents`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildEventBridgeAttributes({
          eventBus: this.config.eventBusName || 'default',
          source: this.config.source,
          detailType: event.detailType,
        }),
      );

      // Optionally inject trace context
      const detail = this.config.injectTraceContext
        ? injectEventBridgeContext(event.detail)
        : event.detail;

      const entry = {
        EventBusName: this.config.eventBusName,
        Source: this.config.source,
        DetailType: event.detailType,
        Detail: JSON.stringify(detail),
        Resources: event.resources,
        Time: event.time,
        TraceHeader: event.traceHeader,
      };

      try {
        const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
        const result = await this.client.send(
          new PutEventsCommand({ Entries: [entry] }),
        );

        const firstEntry = result.Entries?.[0];
        if (firstEntry?.EventId) {
          ctx.setAttribute('aws.eventbridge.event_id', firstEntry.EventId);
        }

        if (result.FailedEntryCount && result.FailedEntryCount > 0) {
          ctx.setStatus({
            code: SpanStatusCode.ERROR,
            message: firstEntry?.ErrorMessage || 'PutEvents failed',
          });
        } else {
          ctx.setStatus({ code: SpanStatusCode.OK });
        }

        return {
          eventId: firstEntry?.EventId,
          failedEntryCount: result.FailedEntryCount,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'PutEvents failed',
        });
        throw error;
      }
    });
  }

  /**
   * Publish multiple events in a batch
   *
   * @param events - Array of events to publish (max 10 per API call)
   * @returns Promise with successful and failed event results
   */
  async putEvents<T extends Record<string, unknown>>(
    events: EventBridgeEvent<T>[],
  ): Promise<{
    successful: Array<{ eventId?: string; detailType: string }>;
    failed: Array<{ errorCode?: string; errorMessage?: string; detailType: string }>;
    failedEntryCount: number;
  }> {
    return trace(`eventbridge.PutEvents.batch`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildEventBridgeAttributes({
          eventBus: this.config.eventBusName || 'default',
          source: this.config.source,
          detailType: 'batch',
        }),
      );
      ctx.setAttribute('aws.eventbridge.batch_size', events.length);

      const entries = events.map((event) => {
        const detail = this.config.injectTraceContext
          ? injectEventBridgeContext(event.detail)
          : event.detail;

        return {
          EventBusName: this.config.eventBusName,
          Source: this.config.source,
          DetailType: event.detailType,
          Detail: JSON.stringify(detail),
          Resources: event.resources,
          Time: event.time,
          TraceHeader: event.traceHeader,
        };
      });

      try {
        const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
        const result = await this.client.send(
          new PutEventsCommand({ Entries: entries }),
        );

        const successful: Array<{ eventId?: string; detailType: string }> = [];
        const failed: Array<{ errorCode?: string; errorMessage?: string; detailType: string }> =
          [];

        if (result.Entries) {
          for (const [index, entry] of result.Entries.entries()) {
            const typedEntry = entry as {
              EventId?: string;
              ErrorCode?: string;
              ErrorMessage?: string;
            };
            if (typedEntry.EventId) {
              successful.push({
                eventId: typedEntry.EventId,
                detailType: events[index].detailType,
              });
            } else {
              failed.push({
                errorCode: typedEntry.ErrorCode,
                errorMessage: typedEntry.ErrorMessage,
                detailType: events[index].detailType,
              });
            }
          }
        }

        ctx.setAttribute('aws.eventbridge.successful_count', successful.length);
        ctx.setAttribute('aws.eventbridge.failed_count', failed.length);

        if (failed.length > 0) {
          ctx.setStatus({
            code: SpanStatusCode.ERROR,
            message: `${failed.length} events failed`,
          });
        } else {
          ctx.setStatus({ code: SpanStatusCode.OK });
        }

        return {
          successful,
          failed,
          failedEntryCount: result.FailedEntryCount || 0,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'PutEvents batch failed',
        });
        throw error;
      }
    });
  }

  /**
   * Publish event with override source
   *
   * Use when you need to publish to a different source than the default.
   *
   * @param event - Event with source override
   * @returns Promise with event ID
   */
  async putEventWithSource<T extends Record<string, unknown>>(
    event: EventBridgeEvent<T> & { source: string },
  ): Promise<{
    eventId?: string;
    failedEntryCount?: number;
  }> {
    return trace(`eventbridge.PutEvents`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildEventBridgeAttributes({
          eventBus: this.config.eventBusName || 'default',
          source: event.source,
          detailType: event.detailType,
        }),
      );

      // Optionally inject trace context
      const detail = this.config.injectTraceContext
        ? injectEventBridgeContext(event.detail)
        : event.detail;

      const entry = {
        EventBusName: this.config.eventBusName,
        Source: event.source, // Use override source
        DetailType: event.detailType,
        Detail: JSON.stringify(detail),
        Resources: event.resources,
        Time: event.time,
        TraceHeader: event.traceHeader,
      };

      try {
        const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
        const result = await this.client.send(
          new PutEventsCommand({ Entries: [entry] }),
        );

        const firstEntry = result.Entries?.[0];
        if (firstEntry?.EventId) {
          ctx.setAttribute('aws.eventbridge.event_id', firstEntry.EventId);
        }

        if (result.FailedEntryCount && result.FailedEntryCount > 0) {
          ctx.setStatus({
            code: SpanStatusCode.ERROR,
            message: firstEntry?.ErrorMessage || 'PutEvents failed',
          });
        } else {
          ctx.setStatus({ code: SpanStatusCode.OK });
        }

        return {
          eventId: firstEntry?.EventId,
          failedEntryCount: result.FailedEntryCount,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'PutEvents failed',
        });
        throw error;
      }
    });
  }
}
