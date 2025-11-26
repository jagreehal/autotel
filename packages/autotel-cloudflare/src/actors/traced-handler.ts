/**
 * Traced handler wrapper for @cloudflare/actors
 *
 * Wraps the Actors handler() to provide:
 * - Root span for the entire request lifecycle
 * - Actor name extraction and correlation
 * - Request routing tracing
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
import type { ActorConfig, ActorConstructor, ActorLike } from './types';

/**
 * Get the tracer instance
 */
function getTracer(): WorkerTracer {
  return trace.getTracer('autotel-cloudflare-actors') as WorkerTracer;
}

/**
 * Worker handler type matching @cloudflare/actors output
 */
interface WorkerHandler<E = unknown> {
  fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response>;
}

/**
 * Create a traced handler that combines Actor instrumentation with request tracing
 *
 * This is an all-in-one wrapper that:
 * 1. Initializes telemetry for the Worker
 * 2. Creates a root span for each incoming request
 * 3. Extracts the Actor name using `nameFromRequest`
 * 4. Instruments the Actor class with lifecycle tracing
 * 5. Routes the request to the instrumented Actor
 *
 * @example
 * ```typescript
 * import { Actor } from '@cloudflare/actors'
 * import { tracedHandler } from 'autotel-cloudflare/actors'
 *
 * class MyActor extends Actor<Env> {
 *   protected onRequest(request: Request) {
 *     return new Response('Hello!')
 *   }
 * }
 *
 * // Export the Actor class and use tracedHandler
 * export { MyActor }
 * export default tracedHandler(MyActor, (env) => ({
 *   service: { name: 'my-actor-service' },
 *   exporter: { url: env.OTLP_ENDPOINT }
 * }))
 * ```
 *
 * @param actorClass - The Actor class to handle requests
 * @param config - Configuration (static object or function)
 * @returns A Worker handler with full tracing
 */
export function tracedHandler<E, A extends ActorLike>(
  actorClass: ActorConstructor<A> & {
    nameFromRequest?(request: Request): Promise<string | undefined>;
    configuration?(request: Request): { locationHint?: DurableObjectLocationHint };
  },
  config: ActorConfig | ((env: E, trigger?: unknown) => ActorConfig),
): WorkerHandler<E> {
  const initialiser = createInitialiser(config as ConfigurationOption);

  // Note: The Actor class instrumentation happens at the DO level, not here.
  // This handler wraps the Worker entrypoint that routes to the DO.

  return {
    async fetch(request: Request, env: E, _ctx: ExecutionContext): Promise<Response> {
      // Initialize telemetry for this request
      const telemetryConfig = initialiser(env, { type: 'http' });
      const configContext = setConfig(telemetryConfig);

      // Extract parent context from request headers
      const parentContext = propagation.extract(configContext, request.headers);

      const tracer = getTracer();
      const url = new URL(request.url);
      const actorClassName = actorClass.name || 'Actor';

      // Get actor name from request (using the Actor's static method if available)
      let actorName: string | undefined;
      try {
        if (actorClass.nameFromRequest) {
          actorName = await actorClass.nameFromRequest(request);
        }
      } catch {
        actorName = undefined;
      }

      const spanName = `${actorClassName} handler: ${request.method} ${url.pathname}`;

      return tracer.startActiveSpan(
        spanName,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'http.request.method': request.method,
            'url.full': request.url,
            'url.path': url.pathname,
            'url.query': url.search,
            'actor.class': actorClassName,
            ...(actorName && { 'actor.name': actorName }),
            'faas.trigger': 'http',
          },
        },
        parentContext,
        async (span) => {
          try {
            // Get Actor stub using the same pattern as @cloudflare/actors handler()
            const envObj = env as Record<string, DurableObjectNamespace>;

            // Find the binding name for this Actor class
            const bindingName = Object.keys(envObj).find((key) => {
              const binding = (env as Record<string, unknown>).__DURABLE_OBJECT_BINDINGS as
                | Record<string, { class_name?: string }>
                | undefined;
              return key === actorClassName || binding?.[key]?.class_name === actorClassName;
            });

            if (!bindingName) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: `No Durable Object binding found for ${actorClassName}`,
              });
              return Response.json(
                {
                  error: 'Configuration Error',
                  message: `No Durable Object binding found for actor class ${actorClassName}`,
                },
                { status: 500, headers: { 'Content-Type': 'application/json' } },
              );
            }

            const namespace = envObj[bindingName];
            const idString = actorName || 'default';

            // Get location hint if available
            const locationHint = actorClass.configuration?.(request)?.locationHint;

            // Get the Durable Object stub
            const stub = namespace.getByName(idString, { locationHint });

            // Set the name on the stub (as @cloudflare/actors does)
            if ('setName' in stub && typeof stub.setName === 'function') {
              (stub as unknown as { setName(id: string): void }).setName(idString);
            }

            // Inject trace context into the request for propagation to the DO
            const headers = new Headers(request.headers);
            propagation.inject(api_context.active(), headers);

            // Create a new request with the injected headers
            const tracedRequest = new Request(request.url, {
              method: request.method,
              headers,
              body: request.body,
              redirect: request.redirect,
            });

            // Forward the request to the Durable Object
            const response = await stub.fetch(tracedRequest);

            span.setAttributes({
              'http.response.status_code': response.status,
              'actor.name': idString,
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

            return Response.json(
              {
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Unknown error',
              },
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            );
          } finally {
            span.end();
          }
        },
      );
    },
  };
}

/**
 * Alternative: Create a handler wrapper that uses the existing @cloudflare/actors handler
 *
 * This is useful if you want to use the original handler() but add tracing around it.
 *
 * @example
 * ```typescript
 * import { Actor, handler } from '@cloudflare/actors'
 * import { wrapHandler } from 'autotel-cloudflare/actors'
 *
 * class MyActor extends Actor<Env> {}
 *
 * export { MyActor }
 * export default wrapHandler(handler(MyActor), (env) => ({
 *   service: { name: 'my-service' }
 * }))
 * ```
 */
export function wrapHandler<E>(
  originalHandler: WorkerHandler<E>,
  config: ActorConfig | ((env: E, trigger?: unknown) => ActorConfig),
): WorkerHandler<E> {
  const initialiser = createInitialiser(config as ConfigurationOption);

  return {
    async fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response> {
      // Initialize telemetry for this request
      const telemetryConfig = initialiser(env, { type: 'http' });
      const configContext = setConfig(telemetryConfig);

      // Extract parent context from request headers
      const parentContext = propagation.extract(configContext, request.headers);

      const tracer = getTracer();
      const url = new URL(request.url);

      return tracer.startActiveSpan(
        `Worker: ${request.method} ${url.pathname}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'http.request.method': request.method,
            'url.full': request.url,
            'url.path': url.pathname,
            'url.query': url.search,
            'faas.trigger': 'http',
          },
        },
        parentContext,
        async (span) => {
          try {
            // Inject trace context into request
            const headers = new Headers(request.headers);
            propagation.inject(api_context.active(), headers);

            const tracedRequest = new Request(request.url, {
              method: request.method,
              headers,
              body: request.body,
              redirect: request.redirect,
            });

            const response = await originalHandler.fetch(tracedRequest, env, ctx);

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
    },
  };
}
