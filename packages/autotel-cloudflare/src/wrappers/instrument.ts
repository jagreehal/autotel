/**
 * Handler instrumentation for Cloudflare Workers
 * 
 * Note: This file uses Cloudflare Workers types (ExportedHandler, Request, Response, etc.)
 * which are globally available via @cloudflare/workers-types when listed in tsconfig.json.
 * These types are devDependencies only - they're not runtime dependencies.
 * At runtime, Cloudflare Workers runtime provides the actual implementations.
 * 
 * Provides automatic OpenTelemetry tracing for:
 * - HTTP handlers (fetch)
 * - Scheduled/cron handlers
 * - Queue handlers (with message tracking)
 * - Email handlers
 * - Auto-instrumentation of Cloudflare bindings (KV, R2, D1, Service Bindings)
 * - Global fetch and cache instrumentation
 * - Post-processor support for span customization
 * - Tail sampling support
 * - Cold start tracking
 */

import {
  trace,
  context as api_context,
  propagation,
  SpanStatusCode,
  SpanKind,
} from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type {
  ConfigurationOption,
  ResolvedEdgeConfig,
  Trigger,
  HandlerInstrumentation,
  InitialSpanInfo,
  ReadableSpan,
} from 'autotel-edge';
import {
  createInitialiser,
  setConfig,
  type Initialiser,
  WorkerTracerProvider,
  WorkerTracer,
} from 'autotel-edge';
import { proxyExecutionContext, unwrap, wrap, type PromiseTracker } from '../bindings/common';
import { instrumentGlobalFetch } from '../global/fetch';
import { instrumentGlobalCache } from '../global/cache';
import { instrumentBindings } from '../bindings/bindings';
import type { Attributes, Span } from '@opentelemetry/api';

type FetchHandler = (
  request: Request,
  env: any,
  ctx: ExecutionContext,
) => Response | Promise<Response>;

type ScheduledHandler = (
  event: ScheduledController,
  env: any,
  ctx: ExecutionContext,
) => void | Promise<void>;

type QueueHandler = (
  batch: MessageBatch,
  env: any,
  ctx: ExecutionContext,
) => void | Promise<void>;

type EmailHandler = (
  message: ForwardableEmailMessage,
  env: any,
  ctx: ExecutionContext,
) => void | Promise<void>;


/**
 * Create fetch handler instrumentation with config support for postProcess
 */
function createFetchInstrumentation(
  config: ResolvedEdgeConfig,
): HandlerInstrumentation<Request, Response> {
  return {
    getInitialSpanInfo: (request: Request): InitialSpanInfo => {
      const url = new URL(request.url);

      return {
        name: `${request.method} ${url.pathname}`,
        options: {
          kind: SpanKind.SERVER,
          attributes: {
            'http.request.method': request.method,
            'url.full': request.url,
          },
        },
        context: propagation.extract(api_context.active(), request.headers),
      };
    },
    getAttributesFromResult: (response: Response) => ({
      'http.response.status_code': response.status,
    }),
    executionSucces: (span: Span, trigger: Request, result: Response) => {
      // Call postProcess callback if configured
      if (config.handlers.fetch.postProcess) {
        const readableSpan = span as unknown as ReadableSpan;
        config.handlers.fetch.postProcess(span, {
          request: trigger,
          response: result,
          readable: readableSpan,
        });
      }
    },
  };
}

/**
 * Scheduled handler instrumentation
 */
const scheduledInstrumentation: HandlerInstrumentation<ScheduledController, void> = {
  getInitialSpanInfo: (event: ScheduledController): InitialSpanInfo => {
    return {
      name: `scheduledHandler ${event.cron || 'unknown'}`,
      options: {
        kind: SpanKind.INTERNAL,
        attributes: {
          'faas.trigger': 'timer',
          'faas.cron': event.cron || 'unknown',
          'faas.scheduled_time': new Date(event.scheduledTime).toISOString(),
        },
      },
    };
  },
};

/**
 * Tracks message status counts for queue processing
 */
class MessageStatusCount {
  succeeded = 0;
  failed = 0;
  implicitly_acked = 0;
  implicitly_retried = 0;
  readonly total: number;

  constructor(total: number) {
    this.total = total;
  }

  ack() {
    this.succeeded = this.succeeded + 1;
  }

  ackRemaining() {
    this.implicitly_acked = this.total - this.succeeded - this.failed;
    this.succeeded = this.total - this.failed;
  }

  retry() {
    this.failed = this.failed + 1;
  }

  retryRemaining() {
    this.implicitly_retried = this.total - this.succeeded - this.failed;
    this.failed = this.total - this.succeeded;
  }

  toAttributes(): Attributes {
    return {
      'queue.messages_count': this.total,
      'queue.messages_success': this.succeeded,
      'queue.messages_failed': this.failed,
      'queue.batch_success': this.succeeded === this.total,
      'queue.implicitly_acked': this.implicitly_acked,
      'queue.implicitly_retried': this.implicitly_retried,
    };
  }
}

/**
 * Add event to active span
 */
function addQueueEvent(name: string, msg?: Message, delaySeconds?: number) {
  const attrs: Attributes = {};
  if (msg) {
    attrs['queue.message_id'] = msg.id;
    attrs['queue.message_timestamp'] = msg.timestamp.toISOString();
    // Add attempts if available (from Cloudflare Queues API)
    if ('attempts' in msg && typeof msg.attempts === 'number') {
      attrs['queue.message_attempts'] = msg.attempts;
    }
  }
  if (delaySeconds !== undefined) {
    attrs['queue.retry_delay_seconds'] = delaySeconds;
  }
  trace.getActiveSpan()?.addEvent(name, attrs);
}

/**
 * Proxy a queue message to track ack/retry operations
 */
function proxyQueueMessage<Q>(msg: Message<Q>, count: MessageStatusCount): Message<Q> {
  const msgHandler: ProxyHandler<Message<Q>> = {
    get: (target, prop) => {
      if (prop === 'ack') {
        const ackFn = Reflect.get(target, prop);
        return new Proxy(ackFn, {
          apply: (fnTarget) => {
            addQueueEvent('messageAck', msg);
            count.ack();
            Reflect.apply(fnTarget, msg, []);
          },
        });
      } else if (prop === 'retry') {
        const retryFn = Reflect.get(target, prop);
        return new Proxy(retryFn, {
          apply: (fnTarget, _thisArg, args) => {
            // Extract delay and content type from retry options if provided
            const retryOptions = args[0] as
              | { delaySeconds?: number; contentType?: string }
              | undefined;
            const delaySeconds = retryOptions?.delaySeconds;

            addQueueEvent('messageRetry', msg, delaySeconds);

            // Add content type attribute if provided
            if (retryOptions?.contentType) {
              const span = trace.getActiveSpan();
              if (span) {
                span.setAttribute('queue.message.content_type', retryOptions.contentType);
              }
            }

            count.retry();
            const result = Reflect.apply(fnTarget, msg, args);
            return result;
          },
        });
      } else {
        return Reflect.get(target, prop, msg);
      }
    },
  };
  return wrap(msg, msgHandler);
}

/**
 * Proxy MessageBatch to track ackAll/retryAll operations
 */
function proxyMessageBatch(batch: MessageBatch, count: MessageStatusCount): MessageBatch {
  const batchHandler: ProxyHandler<MessageBatch> = {
    get: (target, prop) => {
      if (prop === 'messages') {
        const messages = Reflect.get(target, prop);
        const messagesHandler: ProxyHandler<MessageBatch['messages']> = {
          get: (target, prop) => {
            if (typeof prop === 'string' && !isNaN(parseInt(prop))) {
              const message = Reflect.get(target, prop);
              return proxyQueueMessage(message, count);
            } else {
              return Reflect.get(target, prop);
            }
          },
        };
        return wrap(messages, messagesHandler);
      } else if (prop === 'ackAll') {
        const ackFn = Reflect.get(target, prop);
        return new Proxy(ackFn, {
          apply: (fnTarget) => {
            addQueueEvent('ackAll');
            count.ackRemaining();
            Reflect.apply(fnTarget, batch, []);
          },
        });
      } else if (prop === 'retryAll') {
        const retryFn = Reflect.get(target, prop);
        return new Proxy(retryFn, {
          apply: (fnTarget, _thisArg, args) => {
            // Extract delay from retryAll options if provided
            const retryOptions = args[0] as { delaySeconds?: number } | undefined;
            const delaySeconds = retryOptions?.delaySeconds;

            addQueueEvent('retryAll', undefined, delaySeconds);
            count.retryRemaining();
            Reflect.apply(fnTarget, batch, args);
          },
        });
      }
      return Reflect.get(target, prop);
    },
  };
  return wrap(batch, batchHandler);
}

/**
 * Queue handler instrumentation with message tracking
 */
class QueueInstrumentation implements HandlerInstrumentation<MessageBatch, void> {
  private count?: MessageStatusCount;

  getInitialSpanInfo(batch: MessageBatch): InitialSpanInfo {
    return {
      name: `queueHandler ${batch.queue || 'unknown'}`,
      options: {
        kind: SpanKind.CONSUMER,
        attributes: {
          'faas.trigger': 'pubsub',
          'queue.name': batch.queue || 'unknown',
        },
      },
    };
  }

  instrumentTrigger(batch: MessageBatch): MessageBatch {
    this.count = new MessageStatusCount(batch.messages.length);
    return proxyMessageBatch(batch, this.count);
  }

  executionSucces(span: Span, _trigger: MessageBatch, _result: void) {
    if (this.count) {
      this.count.ackRemaining();
      span.setAttributes(this.count.toAttributes());
    }
  }

  executionFailed(span: Span, _trigger: MessageBatch, _error?: any) {
    if (this.count) {
      this.count.retryRemaining();
      span.setAttributes(this.count.toAttributes());
    }
  }
}

/**
 * Converts email headers into OpenTelemetry attributes
 */
function headerAttributes(message: { headers: Headers }): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (message.headers instanceof Headers) {
    for (const [key, value] of message.headers.entries()) {
      attrs[`email.header.${key}`] = value;
    }
  }
  return attrs;
}

/**
 * Email handler instrumentation
 */
const emailInstrumentation: HandlerInstrumentation<ForwardableEmailMessage, void> = {
  getInitialSpanInfo: (message: ForwardableEmailMessage): InitialSpanInfo => {
    const attributes: Record<string, string> = {
      'faas.trigger': 'other',
      'messaging.destination.name': message.to || 'unknown',
    };

    // Add message ID if available
    if ('headers' in message && message.headers instanceof Headers) {
      const messageId = message.headers.get('Message-Id');
      if (messageId) {
        attributes['rpc.message.id'] = messageId;
      }
      // Add all headers as attributes
      Object.assign(attributes, headerAttributes(message));
    }

    return {
      name: `emailHandler ${message.to || 'unknown'}`,
      options: {
        kind: SpanKind.CONSUMER,
        attributes,
      },
    };
  },
};


/**
 * Export spans after request completes
 */
async function exportSpans(
  traceId: string,
  tracker: PromiseTracker | undefined,
  ctx: ExecutionContext,
) {
  const tracer = trace.getTracer('autotel-edge');
  if (tracer instanceof WorkerTracer) {
    try {
      // scheduler is available on ExecutionContext at runtime
      const ctxWithScheduler = ctx as ExecutionContext & { scheduler?: { wait(ms: number): Promise<void> } };
      if (ctxWithScheduler.scheduler) {
        await ctxWithScheduler.scheduler.wait(1);
      }
      await tracker?.wait();
      await tracer.forceFlush(traceId);
    } catch (error) {
      // Silently handle exporter errors to prevent worker crashes
      // Exporter failures should not affect the worker's ability to process requests
      // In production, consider logging to a monitoring service
      console.error('[autotel-edge] Failed to export spans:', error);
    }
  }
}

/**
 * Create handler flow with instrumentation
 */
function createHandlerFlow<T extends Trigger, E, R>(
  instrumentation: HandlerInstrumentation<T, R>,
) {
  return (
    handlerFn: (trigger: T, env: E, ctx: ExecutionContext) => R | Promise<R>,
    [trigger, env, context]: [T, E, ExecutionContext],
  ) => {
    const { ctx: proxiedCtx, tracker } = proxyExecutionContext(context);

    const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

    const { name, options, context: spanContext } =
      instrumentation.getInitialSpanInfo(trigger);

    // Add cold start tracking
    if (options.attributes) {
      options.attributes['faas.coldstart'] = coldStart;
    } else {
      options.attributes = { 'faas.coldstart': coldStart };
    }
    coldStart = false;

    const parentContext = spanContext || api_context.active();

    // Instrument trigger if supported (e.g., for queue handler)
    const instrumentedTrigger = instrumentation.instrumentTrigger
      ? instrumentation.instrumentTrigger(trigger)
      : trigger;

    return tracer.startActiveSpan(name, options, parentContext, async (span) => {
      try {
        const result = await handlerFn(instrumentedTrigger, env, proxiedCtx);

        if (instrumentation.getAttributesFromResult) {
          const attributes = instrumentation.getAttributesFromResult(result);
          span.setAttributes(attributes);
        }

        if (instrumentation.executionSucces) {
          instrumentation.executionSucces(span, trigger, result);
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (instrumentation.executionFailed) {
          instrumentation.executionFailed(span, trigger, error);
        }
        throw error;
      } finally {
        span.end();
        context.waitUntil(exportSpans(span.spanContext().traceId, tracker, context));
      }
    });
  };
}

/**
 * Create handler proxy
 */
function createHandlerProxy<T extends Trigger, E, R>(
  _handler: unknown,
  handlerFn: (trigger: T, env: E, ctx: ExecutionContext) => R | Promise<R>,
  initialiser: Initialiser,
  instrumentation: HandlerInstrumentation<T, R>,
): (trigger: T, env: E, ctx: ExecutionContext) => ReturnType<typeof handlerFn> {
  return (trigger: T, env: E, ctx: ExecutionContext) => {
    const config = initialiser(env, trigger);
    
    // Check if instrumentation is disabled (useful for local dev)
    if (config.instrumentation.disabled) {
      // Return handler as-is without instrumentation
      return handlerFn(trigger, env, ctx);
    }
    
    // Auto-instrument Cloudflare bindings in the environment
    const instrumentedEnv = instrumentBindings(env as Record<string, any>) as E;
    
    const configContext = setConfig(config);

    // Initialize provider on first call
    initProvider(config);

    const flowFn = createHandlerFlow<T, E, R>(instrumentation);

    // Execute the handler flow within the config context
    return api_context.with(configContext, () => {
      return flowFn(handlerFn, [trigger, instrumentedEnv, ctx]) as ReturnType<typeof handlerFn>;
    });
  };
}

/**
 * Create handler proxy with dynamic instrumentation (for fetch with postProcess)
 */
function createHandlerProxyWithConfig<T extends Trigger, E, R>(
  _handler: unknown,
  handlerFn: (trigger: T, env: E, ctx: ExecutionContext) => R | Promise<R>,
  initialiser: Initialiser,
  createInstrumentation: (config: ResolvedEdgeConfig) => HandlerInstrumentation<T, R>,
): (trigger: T, env: E, ctx: ExecutionContext) => ReturnType<typeof handlerFn> {
  return (trigger: T, env: E, ctx: ExecutionContext) => {
    const config = initialiser(env, trigger);
    
    // Check if instrumentation is disabled (useful for local dev)
    if (config.instrumentation.disabled) {
      // Return handler as-is without instrumentation
      return handlerFn(trigger, env, ctx);
    }
    
    // Auto-instrument Cloudflare bindings in the environment
    const instrumentedEnv = instrumentBindings(env as Record<string, any>) as E;
    
    const configContext = setConfig(config);

    // Initialize provider on first call
    initProvider(config);

    // Create instrumentation with config
    const instrumentation = createInstrumentation(config);
    const flowFn = createHandlerFlow<T, E, R>(instrumentation);

    // Execute the handler flow within the config context
    return api_context.with(configContext, () => {
      return flowFn(handlerFn, [trigger, instrumentedEnv, ctx]) as ReturnType<typeof handlerFn>;
    });
  };
}

let providerInitialized = false;
let coldStart = true;

/**
 * Initialize the tracer provider
 */
function initProvider(config: ResolvedEdgeConfig): void {
  if (providerInitialized) return;

  // Install global instrumentations
  if (config.instrumentation.instrumentGlobalFetch) {
    instrumentGlobalFetch();
  }
  if (config.instrumentation.instrumentGlobalCache) {
    instrumentGlobalCache();
  }

  // Set up propagator
  propagation.setGlobalPropagator(config.propagator);

  // Create resource
  const resource = resourceFromAttributes({
    'service.name': config.service.name,
    'service.version': config.service.version,
    'service.namespace': config.service.namespace,
    'cloud.provider': 'cloudflare',
    'cloud.platform': 'cloudflare.workers',
    'telemetry.sdk.name': 'autotel-edge',
    'telemetry.sdk.language': 'js',
  });

  // Create and register provider
  const provider = new WorkerTracerProvider(config.spanProcessors, resource);
  provider.register();

  // Set head sampler on tracer
  const tracer = trace.getTracer('autotel-edge') as WorkerTracer;
  tracer.setHeadSampler(config.sampling.headSampler);

  providerInitialized = true;
}

/**
 * Instrument a Cloudflare Workers handler
 *
 * @example
 * ```typescript
 * import { instrument } from 'autotel-edge'
 *
 * const handler = {
 *   async fetch(request, env, ctx) {
 *     return new Response('Hello World')
 *   }
 * }
 *
 * export default instrument(handler, {
 *   exporter: {
 *     url: env.OTLP_ENDPOINT,
 *     headers: { 'x-api-key': env.API_KEY }
 *   },
 *   service: { name: 'my-worker' }
 * })
 * ```
 */
export function instrument<E, Q = any, C = any>(
  handler: ExportedHandler<E, Q, C>,
  config: ConfigurationOption,
): ExportedHandler<E, Q, C> {
  const initialiser = createInitialiser(config);

  if (handler.fetch) {
    const fetcher = unwrap(handler.fetch) as FetchHandler;
    // Create fetch instrumentation with config support
    handler.fetch = createHandlerProxyWithConfig(
      handler,
      fetcher,
      initialiser,
      createFetchInstrumentation,
    );
  }

  if (handler.scheduled) {
    const scheduled = unwrap(handler.scheduled) as ScheduledHandler;
    handler.scheduled = createHandlerProxy(
      handler,
      scheduled,
      initialiser,
      scheduledInstrumentation,
    );
  }

  if (handler.queue) {
    const queue = unwrap(handler.queue) as QueueHandler;
    handler.queue = createHandlerProxy(
      handler,
      queue,
      initialiser,
      new QueueInstrumentation(),
    );
  }

  if (handler.email) {
    const email = unwrap(handler.email) as EmailHandler;
    handler.email = createHandlerProxy(
      handler,
      email,
      initialiser,
      emailInstrumentation,
    );
  }

  return handler;
}
