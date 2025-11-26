/**
 * Durable Objects instrumentation for Cloudflare Workers
 * 
 * Note: This file uses Cloudflare Workers types (DurableObjectId, DurableObjectState, etc.)
 * which are globally available via @cloudflare/workers-types when listed in tsconfig.json.
 * These types are devDependencies only - they're not runtime dependencies.
 * At runtime, Cloudflare Workers runtime provides the actual implementations.
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

// Durable Object types
type DOFetchFn = (request: Request) => Response | Promise<Response>;
type DOAlarmFn = () => void | Promise<void>;

/**
 * Track cold starts per DO class
 */
const coldStarts = new WeakMap<any, boolean>();

function isColdStart(doClass: any): boolean {
  if (!coldStarts.has(doClass)) {
    coldStarts.set(doClass, true);
    return true;
  }
  return false;
}

/**
 * Instrument a Durable Object fetch method
 */
function instrumentDOFetch(
  fetchFn: DOFetchFn,
  id: DurableObjectId,
  doClass: any,
): DOFetchFn {
  return async function instrumentedFetch(
    this: any,
    request: Request,
  ): Promise<Response> {
    const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

    // Extract parent context from request headers
    const parentContext = propagation.extract(
      api_context.active(),
      request.headers,
    );

    const url = new URL(request.url);
    const spanName = `DO ${id.name || id.toString()}: ${request.method} ${url.pathname}`;

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': request.method,
          'url.full': request.url,
          'do.id': id.toString(),
          'do.id.name': id.name || '',
          'faas.trigger': 'http',
          'faas.coldstart': isColdStart(doClass),
        },
      },
      parentContext,
      async (span) => {
        try {
          const response = await fetchFn.call(this, request);

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
 * Instrument a Durable Object alarm method
 */
function instrumentDOAlarm(
  alarmFn: DOAlarmFn,
  id: DurableObjectId,
  doClass: any,
): DOAlarmFn {
  return async function instrumentedAlarm(this: any): Promise<void> {
    const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

    const spanName = `DO ${id.name || id.toString()}: alarm`;

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'do.id': id.toString(),
          'do.id.name': id.name || '',
          'faas.trigger': 'timer',
          'faas.coldstart': isColdStart(doClass),
        },
      },
      async (span) => {
        try {
          await alarmFn.call(this);
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
 * Instrument a Durable Object instance
 */
function instrumentDOInstance(
  doInstance: any,
  state: DurableObjectState,
  _env: any,
  doClass: any,
): any {
  const instanceHandler: ProxyHandler<any> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'fetch' && typeof value === 'function') {
        return instrumentDOFetch(value.bind(target), state.id, doClass);
      }

      if (prop === 'alarm' && typeof value === 'function') {
        return instrumentDOAlarm(value.bind(target), state.id, doClass);
      }

      // Bind other methods to the target
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  };

  return wrap(doInstance, instanceHandler);
}

/**
 * Instrument a Durable Object class
 *
 * This wraps the DO class to automatically trace all fetch and alarm calls,
 * as well as initialize the telemetry configuration.
 *
 * **Usage:**
 * ```typescript
 * import { DurableObject } from 'cloudflare:workers'
 * import { instrumentDO } from 'autotel-edge'
 *
 * export class Counter extends DurableObject<Env> {
 *   async fetch(request: Request) {
 *     // Your DO logic here
 *     return new Response('OK')
 *   }
 * }
 *
 * // Wrap the class before exporting
 * export const CounterDO = instrumentDO(Counter, (env: Env) => ({
 *   exporter: {
 *     url: env.OTLP_ENDPOINT,
 *     headers: { 'x-api-key': env.API_KEY }
 *   },
 *   service: {
 *     name: 'my-durable-object',
 *     version: '1.0.0'
 *   }
 * }))
 * ```
 *
 * **What you get:**
 * - 🎯 Automatic spans for fetch() calls with HTTP attributes
 * - ⏰ Automatic spans for alarm() calls
 * - 🥶 Cold start tracking
 * - 🔗 Context propagation from incoming requests
 * - ⚡ Automatic span lifecycle management
 *
 * @param doClass - The Durable Object class to instrument
 * @param config - Configuration or configuration function
 * @returns Instrumented Durable Object class
 */
export function instrumentDO<C extends new (state: DurableObjectState, env: any) => any>(
  doClass: C,
  config: ConfigurationOption,
): C {
  const initialiser = createInitialiser(config);

  const classHandler: ProxyHandler<C> = {
    construct(target, [state, env]: [DurableObjectState, any]) {
      // Initialize config for this DO instance
      const trigger = {
        id: state.id.toString(),
        name: state.id.name,
      };
      const doConfig = initialiser(env, trigger);
      const context = setConfig(doConfig);

      // Create the DO instance within the config context
      const doInstance = api_context.with(context, () => {
        return new target(state, env);
      });

      // Instrument the instance
      return instrumentDOInstance(doInstance, state, env, doClass);
    },
  };

  return wrap(doClass, classHandler);
}
