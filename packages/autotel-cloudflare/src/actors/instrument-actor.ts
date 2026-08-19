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
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import {
  asFunction,
  asString,
  describeValue,
  member,
  readProperty,
  type UnknownRecord,
} from '../values.js';

/**
 * Track cold starts per Actor class
 */
const coldStarts = new WeakMap<object, boolean>();

/**
 * The Actor class being instrumented. Its own type belongs to the application,
 * so this names only what the wrappers read off it: the class name that goes on
 * the span, and the marker used to detect a cold start.
 */
/** What an Actor persists, and what a WebSocket carries: the app's own values. */
type ActorPayload =
  | string
  | number
  | boolean
  | null
  | undefined
  | UnknownRecord
  | unknown[]
  | ArrayBuffer;

/** What the runtime passes an alarm handler. */
interface AlarmInvocation {
  retryCount?: number;
  isRetry?: boolean;
}

/** The env a Durable Object is constructed with: whatever wrangler bound. */
type ActorEnv = UnknownRecord;

interface ActorClass {
  readonly name?: string;
}

function isColdStart(actorClass: ActorClass): boolean {
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
  return workerTracer('autotel-cloudflare-actors');
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
/** The attributes every actor span carries, whatever its lifecycle stage. */
interface ActorAttributes {
  [key: string]: string | boolean | number;
}

function createActorAttributes(
  actorInstance: ActorLike,
  actorClass: ActorClass,
  lifecycle: ActorLifecycle,
): ActorAttributes {
  return {
    'actor.name': actorInstance.name || 'unknown',
    'actor.class': actorClass.name || 'Actor',
    'actor.lifecycle': lifecycle,
    'actor.coldstart': isColdStart(actorClass),
    ...(actorInstance.identifier && {
      'actor.identifier': actorInstance.identifier,
    }),
  };
}

/**
 * Instrument the onInit lifecycle method
 */
function instrumentOnInit(
  originalMethod: () => Promise<void>,
  actorInstance: ActorLike,
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): () => Promise<void> {
  return async function instrumentedOnInit(): Promise<void> {
    const tracer = getTracer();
    const actorClassName = actorClass.name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'init')
      : defaultSpanNameFormatter(
          actorInstance.name || '',
          actorClassName,
          'init',
        );

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
          span.recordException(toException(error));
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
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): (request: Request) => Promise<Response> {
  return async function instrumentedOnRequest(
    request: Request,
  ): Promise<Response> {
    const tracer = getTracer();

    // Extract parent context from request headers
    const parentContext = propagation.extract(
      api_context.active(),
      request.headers,
    );

    const url = new URL(request.url);
    const actorClassName = actorClass.name || 'Actor';
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
          span.recordException(toException(error));
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
  originalMethod: (alarmInfo?: AlarmInvocation) => Promise<void>,
  actorInstance: ActorLike,
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): (alarmInfo?: AlarmInvocation) => Promise<void> {
  return async function instrumentedOnAlarm(
    alarmInfo?: AlarmInvocation,
  ): Promise<void> {
    const tracer = getTracer();
    const actorClassName = actorClass.name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'alarm')
      : defaultSpanNameFormatter(
          actorInstance.name || '',
          actorClassName,
          'alarm',
        );

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
          span.recordException(toException(error));
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
  originalMethod: (key: string, value: ActorPayload) => void,
  actorInstance: ActorLike,
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): (key: string, value: ActorPayload) => void {
  if (!options.capturePersistEvents) {
    return originalMethod;
  }

  return function instrumentedOnPersist(
    key: string,
    value: ActorPayload,
  ): void {
    const tracer = getTracer();
    const actorClassName = actorClass.name || 'Actor';
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
          'actor.persist.value_type': describeValue(value),
        },
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, key, value);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(toException(error));
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
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): (ws: WebSocket, request: Request) => void {
  return function instrumentedWebSocketConnect(
    ws: WebSocket,
    request: Request,
  ): void {
    const tracer = getTracer();
    const actorClassName = actorClass.name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'websocket.connect')
      : defaultSpanNameFormatter(
          actorInstance.name || '',
          actorClassName,
          'websocket.connect',
        );

    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          ...createActorAttributes(
            actorInstance,
            actorClass,
            'websocket.connect',
          ),
          'url.full': request.url,
        },
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, ws, request);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(toException(error));
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
  originalMethod: (ws: WebSocket, message: ActorPayload) => void,
  actorInstance: ActorLike,
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): (ws: WebSocket, message: ActorPayload) => void {
  return function instrumentedWebSocketMessage(
    ws: WebSocket,
    message: ActorPayload,
  ): void {
    const tracer = getTracer();
    const actorClassName = actorClass.name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(actorInstance.name || '', 'websocket.message')
      : defaultSpanNameFormatter(
          actorInstance.name || '',
          actorClassName,
          'websocket.message',
        );

    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          ...createActorAttributes(
            actorInstance,
            actorClass,
            'websocket.message',
          ),
          'websocket.message.type': describeValue(message),
          'websocket.message.size':
            asString(message)?.length ??
            (message instanceof ArrayBuffer ? message.byteLength : 0),
        },
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, ws, message);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(toException(error));
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
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): (ws: WebSocket) => void {
  return function instrumentedWebSocketDisconnect(ws: WebSocket): void {
    const tracer = getTracer();
    const actorClassName = actorClass.name || 'Actor';
    const spanName = options.spanNameFormatter
      ? options.spanNameFormatter(
          actorInstance.name || '',
          'websocket.disconnect',
        )
      : defaultSpanNameFormatter(
          actorInstance.name || '',
          actorClassName,
          'websocket.disconnect',
        );

    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: createActorAttributes(
          actorInstance,
          actorClass,
          'websocket.disconnect',
        ),
      },
      (span) => {
        try {
          originalMethod.call(actorInstance, ws);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(toException(error));
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
  _env: ActorEnv,
  actorClass: ActorClass,
  options: ActorInstrumentationOptions,
): ActorLike {
  const instanceHandler: ProxyHandler<ActorLike> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      // Lifecycle methods that need instrumentation.
      if (prop === 'onInit' && method) {
        // SAFETY: `prop` names the actor lifecycle method being wrapped, so
        // the bound function is that method with that method's own signature.
        return instrumentOnInit(
          method.bind(target) as () => Promise<void>,
          target,
          actorClass,
          options,
        );
      }

      if (prop === 'onRequest' && method) {
        // SAFETY: see the note on onInit above.
        return instrumentOnRequest(
          method.bind(target) as (request: Request) => Promise<Response>,
          target,
          actorClass,
          options,
        );
      }

      if (prop === 'onAlarm' && method) {
        // SAFETY: see the note on onInit above.
        return instrumentOnAlarm(
          method.bind(target) as (alarmInfo?: AlarmInvocation) => Promise<void>,
          target,
          actorClass,
          options,
        );
      }

      if (prop === 'onPersist' && method) {
        return instrumentOnPersist(
          method.bind(target),
          target,
          actorClass,
          options,
        );
      }

      if (prop === 'onWebSocketConnect' && method) {
        return instrumentWebSocketConnect(
          method.bind(target),
          target,
          actorClass,
          options,
        );
      }

      if (prop === 'onWebSocketMessage' && method) {
        return instrumentWebSocketMessage(
          method.bind(target),
          target,
          actorClass,
          options,
        );
      }

      if (prop === 'onWebSocketDisconnect' && method) {
        return instrumentWebSocketDisconnect(
          method.bind(target),
          target,
          actorClass,
          options,
        );
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
      return method ? method.bind(target) : value;
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
  config:
    ActorConfig | ((env: ActorEnv, trigger?: ActorPayload) => ActorConfig),
): C {
  // SAFETY: a ConfigurationOption is exactly "a config, or a function
  // producing one from the environment", which is what this parameter says.
  const initialiser = createInitialiser(config as ConfigurationOption);

  // Default options
  const defaultOptions: ActorInstrumentationOptions = {
    instrumentStorage: true,
    instrumentAlarms: true,
    instrumentSockets: true,
    capturePersistEvents: true,
  };

  const classHandler: ProxyHandler<C> = {
    construct(target, [state, env]: [DurableObjectState, ActorEnv]) {
      // Get config (either static or from function)
      const resolvedConfig =
        typeof config === 'function'
          ? config(env, { id: state.id.toString(), name: state.id.name })
          : config;

      // Merge options with defaults. The actors block is optional on a
      // resolved worker config, so a config without one keeps the defaults.
      // SAFETY: the block is this package's own option type wherever present.
      const actorOptions = readProperty(resolvedConfig, 'actors') as
        ActorInstrumentationOptions | undefined;
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
      // SAFETY: constructing the application's own Actor class; the assertion
      // at the end of this call names the lifecycle surface we then wrap.
      const actorInstance = api_context.with(context, () => {
        return new target(state, env);
      }) as ActorLike;

      // Instrument the instance
      return instrumentActorInstance(
        actorInstance,
        state,
        env,
        actorClass,
        options,
      );
    },
  };

  return wrap(actorClass, classHandler);
}
