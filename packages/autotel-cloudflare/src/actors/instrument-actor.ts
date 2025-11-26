/**
 * Actor class instrumentation for @cloudflare/actors
 *
 * Wraps Actor lifecycle methods with OpenTelemetry tracing:
 * - onInit: Traced as 'actor.lifecycle': 'init'
 * - onRequest: Traced with full HTTP semantics
 * - onAlarm: Traced as 'actor.lifecycle': 'alarm'
 * - onPersist: Traced as 'actor.lifecycle': 'persist'
 * - WebSocket methods: Traced with socket semantics
 */

import {
  trace,
  context as api_context,
  propagation,
  SpanStatusCode,
  SpanKind,
} from '@opentelemetry/api';
import type { ConfigurationOption } from 'autotel-edge';
import { createInitialiser, setConfig, WorkerTracer } from 'autotel-edge';
import { wrap } from '../bindings/common';
import type {
  ActorConfig,
  ActorConstructor,
  ActorLike,
  ActorLifecycle,
  ActorInstrumentationOptions,
} from './types';
import { instrumentActorStorage } from './storage';
import { instrumentActorAlarms } from './alarms';
import { instrumentActorSockets } from './sockets';

/**
 * Track cold starts per Actor class
 */
const coldStarts = new WeakMap<object, boolean>();

function isColdStart(actorClass: object): boolean {
  if (!coldStarts.has(actorClass)) {
    coldStarts.set(actorClass, true);
    return true;
  }
  return false;
}

/**
 * Get the tracer instance
 */
function getTracer(): WorkerTracer {
  return trace.getTracer('autotel-cloudflare-actors') as WorkerTracer;
}

/**
 * Default span name formatter
 */
function defaultSpanNameFormatter(
  actorName: string,
  actorClass: string,
  lifecycle: ActorLifecycle,
): string {
  const displayName = actorName || actorClass;
  return `Actor ${displayName}: ${lifecycle}`;
}

/**
 * Create base Actor span attributes
 */
function createActorAttributes(
  actorInstance: ActorLike,
  actorClass: object,
  lifecycle: ActorLifecycle,
): Record<string, string | boolean | number> {
  return {
    'actor.name': actorInstance.name || 'unknown',
    'actor.class': (actorClass as { name?: string }).name || 'Actor',
    'actor.lifecycle': lifecycle,
    'actor.coldstart': isColdStart(actorClass),
    ...(actorInstance.identifier && { 'actor.identifier': actorInstance.identifier }),
  };
}

/**
 * Instrument the onInit lifecycle method
 */
function instrumentOnInit(
  originalMethod: () => Promise<void>,
  actorInstance: ActorLike,
  actorClass: object,
  options: ActorInstrumentationOptions,
): () => Promise<void> {
  return async function instrumentedOnInit(): Promise<void> {
    const tracer = getTracer();
    const actorClassName = (actorClass as { name?: string }).name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'init')
      : defaultSpanNameFormatter(actorInstance.name || '', actorClassName, 'init');

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.INTERNAL,
        attributes: createActorAttributes(actorInstance, actorClass, 'init'),
      },
      async (span) => {
        try {
          await originalMethod.call(actorInstance);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Instrument the onRequest lifecycle method
 */
function instrumentOnRequest(
  originalMethod: (request: Request) => Promise<Response>,
  actorInstance: ActorLike,
  actorClass: object,
  options: ActorInstrumentationOptions,
): (request: Request) => Promise<Response> {
  return async function instrumentedOnRequest(request: Request): Promise<Response> {
    const tracer = getTracer();

    // Extract parent context from request headers
    const parentContext = propagation.extract(api_context.active(), request.headers);

    const url = new URL(request.url);
    const actorClassName = (actorClass as { name?: string }).name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'request')
      : `Actor ${actorInstance.name || actorClassName}: ${request.method} ${url.pathname}`;

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          ...createActorAttributes(actorInstance, actorClass, 'request'),
          'http.request.method': request.method,
          'url.full': request.url,
          'url.path': url.pathname,
          'url.query': url.search,
        },
      },
      parentContext,
      async (span) => {
        try {
          const response = await originalMethod.call(actorInstance, request);

          span.setAttributes({
            'http.response.status_code': response.status,
          });

          if (response.ok) {
            span.setStatus({ code: SpanStatusCode.OK });
          } else {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }

          return response;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Instrument the onAlarm lifecycle method
 */
function instrumentOnAlarm(
  originalMethod: (alarmInfo?: unknown) => Promise<void>,
  actorInstance: ActorLike,
  actorClass: object,
  options: ActorInstrumentationOptions,
): (alarmInfo?: unknown) => Promise<void> {
  return async function instrumentedOnAlarm(alarmInfo?: unknown): Promise<void> {
    const tracer = getTracer();
    const actorClassName = (actorClass as { name?: string }).name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'alarm')
      : defaultSpanNameFormatter(actorInstance.name || '', actorClassName, 'alarm');

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          ...createActorAttributes(actorInstance, actorClass, 'alarm'),
          'faas.trigger': 'timer',
        },
      },
      async (span) => {
        try {
          await originalMethod.call(actorInstance, alarmInfo);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Instrument the onPersist lifecycle method
 */
function instrumentOnPersist(
  originalMethod: (key: string, value: unknown) => void,
  actorInstance: ActorLike,
  actorClass: object,
  options: ActorInstrumentationOptions,
): (key: string, value: unknown) => void {
  if (!options.capturePersistEvents) {
    return originalMethod;
  }

  return function instrumentedOnPersist(key: string, value: unknown): void {
    const tracer = getTracer();
    const actorClassName = (actorClass as { name?: string }).name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'persist')
      : `Actor ${actorInstance.name || actorClassName}: persist ${key}`;

    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          ...createActorAttributes(actorInstance, actorClass, 'persist'),
          'actor.persist.key': key,
          'actor.persist.value_type': typeof value,
        },
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, key, value);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Instrument WebSocket lifecycle methods
 */
function instrumentWebSocketConnect(
  originalMethod: (ws: WebSocket, request: Request) => void,
  actorInstance: ActorLike,
  actorClass: object,
  options: ActorInstrumentationOptions,
): (ws: WebSocket, request: Request) => void {
  return function instrumentedWebSocketConnect(ws: WebSocket, request: Request): void {
    const tracer = getTracer();
    const actorClassName = (actorClass as { name?: string }).name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'websocket.connect')
      : defaultSpanNameFormatter(actorInstance.name || '', actorClassName, 'websocket.connect');

    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          ...createActorAttributes(actorInstance, actorClass, 'websocket.connect'),
          'url.full': request.url,
        },
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, ws, request);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

function instrumentWebSocketMessage(
  originalMethod: (ws: WebSocket, message: unknown) => void,
  actorInstance: ActorLike,
  actorClass: object,
  options: ActorInstrumentationOptions,
): (ws: WebSocket, message: unknown) => void {
  return function instrumentedWebSocketMessage(ws: WebSocket, message: unknown): void {
    const tracer = getTracer();
    const actorClassName = (actorClass as { name?: string }).name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'websocket.message')
      : defaultSpanNameFormatter(actorInstance.name || '', actorClassName, 'websocket.message');

    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          ...createActorAttributes(actorInstance, actorClass, 'websocket.message'),
          'websocket.message.type': typeof message,
          'websocket.message.size':
            typeof message === 'string'
              ? message.length
              : message instanceof ArrayBuffer
                ? message.byteLength
                : 0,
        },
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, ws, message);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

function instrumentWebSocketDisconnect(
  originalMethod: (ws: WebSocket) => void,
  actorInstance: ActorLike,
  actorClass: object,
  options: ActorInstrumentationOptions,
): (ws: WebSocket) => void {
  return function instrumentedWebSocketDisconnect(ws: WebSocket): void {
    const tracer = getTracer();
    const actorClassName = (actorClass as { name?: string }).name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'websocket.disconnect')
      : defaultSpanNameFormatter(actorInstance.name || '', actorClassName, 'websocket.disconnect');

    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: createActorAttributes(actorInstance, actorClass, 'websocket.disconnect'),
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, ws);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Instrument an Actor instance by wrapping all lifecycle methods
 */
function instrumentActorInstance(
  actorInstance: ActorLike,
  _state: DurableObjectState,
  _env: unknown,
  actorClass: object,
  options: ActorInstrumentationOptions,
): ActorLike {
  const instanceHandler: ProxyHandler<ActorLike> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Lifecycle methods that need instrumentation
      if (prop === 'onInit' && typeof value === 'function') {
        return instrumentOnInit(value.bind(target), target, actorClass, options);
      }

      if (prop === 'onRequest' && typeof value === 'function') {
        return instrumentOnRequest(value.bind(target), target, actorClass, options);
      }

      if (prop === 'onAlarm' && typeof value === 'function') {
        return instrumentOnAlarm(value.bind(target), target, actorClass, options);
      }

      if (prop === 'onPersist' && typeof value === 'function') {
        return instrumentOnPersist(value.bind(target), target, actorClass, options);
      }

      if (prop === 'onWebSocketConnect' && typeof value === 'function') {
        return instrumentWebSocketConnect(value.bind(target), target, actorClass, options);
      }

      if (prop === 'onWebSocketMessage' && typeof value === 'function') {
        return instrumentWebSocketMessage(value.bind(target), target, actorClass, options);
      }

      if (prop === 'onWebSocketDisconnect' && typeof value === 'function') {
        return instrumentWebSocketDisconnect(value.bind(target), target, actorClass, options);
      }

      // Instrument sub-components if enabled
      if (prop === 'storage' && value && options.instrumentStorage !== false) {
        return instrumentActorStorage(value, target, actorClass);
      }

      if (prop === 'alarms' && value && options.instrumentAlarms !== false) {
        return instrumentActorAlarms(value, target, actorClass);
      }

      if (prop === 'sockets' && value && options.instrumentSockets !== false) {
        return instrumentActorSockets(value, target, actorClass);
      }

      // Bind other methods to the target
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  };

  return wrap(actorInstance, instanceHandler);
}

/**
 * Instrument an Actor class for comprehensive OpenTelemetry tracing
 *
 * This wraps the Actor class to automatically trace all lifecycle methods:
 * - onInit: Actor initialization
 * - onRequest: HTTP request handling
 * - onAlarm: Alarm triggers
 * - onPersist: Property persistence events
 * - WebSocket methods: Connection, message, disconnect
 *
 * It also optionally instruments:
 * - actor.storage: SQL queries and storage operations
 * - actor.alarms: Alarm scheduling operations
 * - actor.sockets: WebSocket operations
 *
 * @example
 * ```typescript
 * import { Actor } from '@cloudflare/actors'
 * import { instrumentActor } from 'autotel-cloudflare/actors'
 *
 * class Counter extends Actor<Env> {
 *   protected onInit() {
 *     console.log('Counter initialized')
 *   }
 *
 *   protected onRequest(request: Request) {
 *     return new Response('count: 42')
 *   }
 * }
 *
 * // Wrap the class
 * export const InstrumentedCounter = instrumentActor(Counter, (env: Env) => ({
 *   service: { name: 'counter-actor' },
 *   exporter: { url: env.OTLP_ENDPOINT },
 *   actors: {
 *     instrumentStorage: true,
 *     capturePersistEvents: true
 *   }
 * }))
 * ```
 *
 * @param actorClass - The Actor class to instrument
 * @param config - Configuration (static object or function)
 * @returns Instrumented Actor class
 */
export function instrumentActor<C extends ActorConstructor>(
  actorClass: C,
  config: ActorConfig | ((env: unknown, trigger?: unknown) => ActorConfig),
): C {
  const initialiser = createInitialiser(config as ConfigurationOption);

  // Default options
  const defaultOptions: ActorInstrumentationOptions = {
    instrumentStorage: true,
    instrumentAlarms: true,
    instrumentSockets: true,
    capturePersistEvents: true,
  };

  const classHandler: ProxyHandler<C> = {
    construct(target, [state, env]: [DurableObjectState, unknown]) {
      // Get config (either static or from function)
      const resolvedConfig =
        typeof config === 'function'
          ? config(env, { id: state.id.toString(), name: state.id.name })
          : config;

      // Merge options with defaults
      // Handle the case where config might not have actors property
      const actorOptions =
        resolvedConfig && typeof resolvedConfig === 'object' && 'actors' in resolvedConfig
          ? (resolvedConfig as { actors?: ActorInstrumentationOptions }).actors
          : undefined;
      const options: ActorInstrumentationOptions = {
        ...defaultOptions,
        ...actorOptions,
      };

      // Initialize telemetry config
      const trigger = {
        id: state.id.toString(),
        name: state.id.name,
      };
      const telemetryConfig = initialiser(env, trigger);
      const context = setConfig(telemetryConfig);

      // Create the Actor instance within the config context
      const actorInstance = api_context.with(context, () => {
        return new target(state, env);
      }) as ActorLike;

      // Instrument the instance
      return instrumentActorInstance(actorInstance, state, env, actorClass, options);
    },
  };

  return wrap(actorClass, classHandler);
}
