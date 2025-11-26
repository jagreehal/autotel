import { trace } from '@opentelemetry/api';
import { getActiveConfig } from '../core/config';
import type {
  OrPromise,
  EdgeEvent,
  FunnelStepStatus,
  OutcomeStatus,
  EdgeTrackEvent,
  EdgeFunnelStepEvent,
  EdgeOutcomeEvent,
  EdgeValueEvent,
  EdgeEventBase,
} from '../types';

export type SubscriberDeliveryMode = 'fire-and-forget' | 'await';

// Re-export event types for convenience


export type EdgeTransport = (event: EdgeEvent) => OrPromise<void>;

export interface EdgeDispatchOptions {
  delivery?: SubscriberDeliveryMode;
  waitUntil?: (promise: Promise<void>) => void;
}

export interface CreateEdgeSubscribersOptions {
  /**
   * User-supplied transport invoked for every Subscribers event.
   * Implementations can call PostHog, Stripe, Zapier, Durable Objects, etc.
   */
  transport: EdgeTransport;
  /**
   * Optional service name used when no request config is active.
   * Defaults to the active instrumentation config's service name or "edge-service".
   */
  service?: string;
  /**
   * Default delivery behaviour for transport promises.
   * "fire-and-forget" (default) will not block the calling code.
   */
  delivery?: SubscriberDeliveryMode;
  /**
   * Default waitUntil handler (Cloudflare Workers, Vercel waitUntil).
   * Used when delivery === "fire-and-forget".
   */
  waitUntil?: (promise: Promise<void>) => void;
  /**
   * Optional error handler invoked when the transport rejects.
   */
  onError?: (error: unknown, event: EdgeEvent) => void;
  /**
   * Include OpenTelemetry trace/span identifiers in the payload. Default true.
   */
  includeTraceContext?: boolean;
}

export interface EdgeSubscribers {
  trackEvent(
    event: string,
    attributes?: Record<string, unknown>,
    options?: EdgeDispatchOptions,
  ): OrPromise<void>;
  trackFunnelStep(
    funnel: string,
    status: FunnelStepStatus,
    attributes?: Record<string, unknown>,
    options?: EdgeDispatchOptions,
  ): OrPromise<void>;
  trackOutcome(
    operation: string,
    outcome: OutcomeStatus,
    attributes?: Record<string, unknown>,
    options?: EdgeDispatchOptions,
  ): OrPromise<void>;
  trackValue(
    metric: string,
    value: number,
    attributes?: Record<string, unknown>,
    options?: EdgeDispatchOptions,
  ): OrPromise<void>;
  dispatch(event: EdgeEvent, options?: EdgeDispatchOptions): OrPromise<void>;
  bind(options: EdgeDispatchOptions): EdgeSubscribers;
}

const DEFAULT_SERVICE_NAME = 'edge-service';

/**
 * Extract a normalized event name from any EdgeEvent.
 * Useful for subscribers that need to send events to events platforms.
 * 
 * @deprecated Use `event.name` directly instead - it's now a property on all events.
 * 
 * @example
 * ```typescript
 * const subscriber: EdgeSubscribersAdapter = async (event) => {
 *   await sendToEvents(event.name, event.attributes) // Use event.name directly
 * }
 * ```
 */
export function getEventName(event: EdgeEvent): string {
  return event.name;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

function createBaseEvent(
  attributes: Record<string, unknown> | undefined,
  options: CreateEdgeSubscribersOptions,
): Omit<EdgeEventBase, 'name'> {
  const config = getActiveConfig();
  // Prioritize explicit service override, then config service name, then default
  const serviceName = options.service ?? config?.service.name ?? DEFAULT_SERVICE_NAME;
  const baseAttributes = attributes ? { ...attributes } : {};

  const baseEvent: Omit<EdgeEventBase, 'name'> = {
    service: serviceName,
    timestamp: Date.now(),
    attributes: baseAttributes,
  };

  if (options.includeTraceContext ?? true) {
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();
    if (spanContext) {
      baseEvent.traceId = spanContext.traceId;
      baseEvent.spanId = spanContext.spanId;
      baseEvent.correlationId = spanContext.traceId.slice(0, 16);
    }
  }

  return baseEvent;
}

function handleError(
  error: unknown,
  event: EdgeEvent,
  options: CreateEdgeSubscribersOptions,
): void {
  if (options.onError) {
    try {
      options.onError(error, event);
      return;
    } catch (handlerError) {
      console.error('[autotel-edge] Subscribers onError handler failed', handlerError);
    }
  }

  console.error('[autotel-edge] Subscribers transport failed', error, { event });
}

function deliverResult(
  result: OrPromise<void>,
  event: EdgeEvent,
  delivery: SubscriberDeliveryMode,
  waitUntil: EdgeDispatchOptions['waitUntil'],
  createOptions: CreateEdgeSubscribersOptions,
): OrPromise<void> {
  if (!isPromiseLike(result)) {
    return delivery === 'await' ? Promise.resolve() : undefined;
  }

  if (delivery === 'await') {
    return Promise.resolve(result).catch((error) => {
      handleError(error, event, createOptions);
      throw error;
    });
  }

  const background = Promise.resolve(result).catch((error) => {
    handleError(error, event, createOptions);
  });

  if (waitUntil) {
    waitUntil(background);
  } else {
    void background;
  }

  return undefined;
}

function createSubscribersInstance(
  options: CreateEdgeSubscribersOptions,
  bindings: EdgeDispatchOptions = {},
): EdgeSubscribers {
  const dispatch = (
    event: EdgeEvent,
    callOptions?: EdgeDispatchOptions,
  ): OrPromise<void> => {
    const delivery =
      callOptions?.delivery ??
      bindings.delivery ??
      options.delivery ??
      ('fire-and-forget' as SubscriberDeliveryMode);
    const waitUntil = callOptions?.waitUntil ?? bindings.waitUntil ?? options.waitUntil;
    const result = options.transport(event);
    return deliverResult(result, event, delivery, waitUntil, options);
  };

  const trackEvent: EdgeSubscribers['trackEvent'] = (eventName, attributes, callOptions) => {
    const baseEvent = createBaseEvent(attributes, options);
    const event: EdgeTrackEvent = {
      ...baseEvent,
      type: 'event',
      event: eventName,
      name: eventName,
    } as EdgeTrackEvent;
    return dispatch(event, callOptions);
  };

  const trackFunnelStep: EdgeSubscribers['trackFunnelStep'] = (
    funnel,
    status,
    attributes,
    callOptions,
  ) => {
    const baseEvent = createBaseEvent(attributes, options);
    const event: EdgeFunnelStepEvent = {
      ...baseEvent,
      type: 'funnel-step',
      funnel,
      status,
      name: `funnel-step.${status}`,
    } as EdgeFunnelStepEvent;
    return dispatch(event, callOptions);
  };

  const trackOutcome: EdgeSubscribers['trackOutcome'] = (
    operation,
    outcome,
    attributes,
    callOptions,
  ) => {
    const baseEvent = createBaseEvent(attributes, options);
    const event: EdgeOutcomeEvent = {
      ...baseEvent,
      type: 'outcome',
      operation,
      outcome,
      name: `outcome.${outcome}`,
    } as EdgeOutcomeEvent;
    return dispatch(event, callOptions);
  };

  const trackValue: EdgeSubscribers['trackValue'] = (
    metric,
    value,
    attributes,
    callOptions,
  ) => {
    const baseEvent = createBaseEvent(attributes, options);
    const event: EdgeValueEvent = {
      ...baseEvent,
      type: 'value',
      metric,
      value,
      name: `value.${metric}`,
    } as EdgeValueEvent;
    return dispatch(event, callOptions);
  };

  return {
    trackEvent,
    trackFunnelStep,
    trackOutcome,
    trackValue,
    dispatch,
    bind: (nextBindings: EdgeDispatchOptions) =>
      createSubscribersInstance(options, { ...bindings, ...nextBindings }),
  };
}

export function createEdgeSubscribers(options: CreateEdgeSubscribersOptions): EdgeSubscribers {
  if (typeof options.transport !== 'function') {
    throw new TypeError('createEdgeSubscribers: options.transport is required');
  }

  return createSubscribersInstance(options);
}

/**
 * Get Subscribers instance from active config, bound to the current ExecutionContext.
 * Returns null if Subscribers is not configured.
 *
 * @example
 * ```typescript
 * export default {
 *   async fetch(request, env, ctx) {
 *     const Subscribers = getEdgeSubscribers(ctx);
 *     if (Subscribers) {
 *       Subscribers.trackEvent('user.signup', { plan: 'pro' });
 *     }
 *     return new Response('ok');
 *   }
 * }
 * ```
 */
export function getEdgeSubscribers(
  ctx?: { waitUntil(promise: Promise<any>): void },
): EdgeSubscribers | null {
  const config = getActiveConfig();
  if (!config) {
    return null;
  }

  const subscribers = config.subscribers ?? [];
  if (subscribers.length === 0) {
    return null;
  }

  // Combine all subscribers into a single transport function
  const combinedTransport: EdgeTransport = async (event) => {
    await Promise.all(
      subscribers.map(async (subscriber, index) => {
        try {
          await subscriber(event);
        } catch (error) {
          console.error('[autotel-edge] Subscribers subscriber failed', error, {
            subscriberIndex: index,
            eventType: event.type,
          });
        }
      }),
    );
  };

  return createEdgeSubscribers({
    transport: combinedTransport,
    service: config.service.name,
    waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
  });
}


export {type FunnelStepStatus, type OutcomeStatus, type EdgeEvent, type EdgeTrackEvent, type EdgeFunnelStepEvent, type EdgeOutcomeEvent, type EdgeValueEvent} from '../types';