/**
 * Actor storage instrumentation
 *
 * Traces operations on actor.storage including SQL queries
 */

import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap } from '../bindings/common';
import type { ActorLike } from './types';

/**
 * Get the tracer instance
 */
function getTracer(): WorkerTracer {
  return trace.getTracer('autotel-cloudflare-actors') as WorkerTracer;
}

/**
 * Instrument Actor storage for tracing
 *
 * Captures:
 * - SQL query operations
 * - Key-value operations (if available)
 */
export function instrumentActorStorage(
  storage: unknown,
  actorInstance: ActorLike,
  actorClass: object,
): unknown {
  if (!storage || typeof storage !== 'object') {
    return storage;
  }

  const actorClassName = (actorClass as { name?: string }).name || 'Actor';
  const actorName = actorInstance.name || actorClassName;

  const storageHandler: ProxyHandler<object> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Instrument SQL query method if it exists
      // The Actors Storage class has an exec method for SQL
      if (prop === 'exec' && typeof value === 'function') {
        return function instrumentedExec(
          this: unknown,
          query: string,
          ...params: unknown[]
        ): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.exec`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'sqlite',
                'db.operation': 'exec',
                'db.statement': query,
                'db.statement.params_count': params.length,
              },
            },
            (span) => {
              try {
                const result = value.call(target, query, ...params);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
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

      // Instrument query method (alternative name for exec)
      if (prop === 'query' && typeof value === 'function') {
        return function instrumentedQuery(
          this: unknown,
          query: string,
          ...params: unknown[]
        ): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.query`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'sqlite',
                'db.operation': 'query',
                'db.statement': query,
                'db.statement.params_count': params.length,
              },
            },
            (span) => {
              try {
                const result = value.call(target, query, ...params);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
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

      // Instrument get method
      if (prop === 'get' && typeof value === 'function') {
        return async function instrumentedGet(this: unknown, key: string): Promise<unknown> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.get`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'durable_object_storage',
                'db.operation': 'get',
                'db.key': key,
              },
            },
            async (span) => {
              try {
                const result = await value.call(target, key);
                span.setAttributes({
                  'db.result.found': result !== null && result !== undefined,
                });
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
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

      // Instrument put method
      if (prop === 'put' && typeof value === 'function') {
        return async function instrumentedPut(
          this: unknown,
          key: string,
          val: unknown,
        ): Promise<void> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.put`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'durable_object_storage',
                'db.operation': 'put',
                'db.key': key,
                'db.value_type': typeof val,
              },
            },
            async (span) => {
              try {
                await value.call(target, key, val);
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

      // Instrument delete method
      if (prop === 'delete' && typeof value === 'function') {
        return async function instrumentedDelete(this: unknown, key: string): Promise<boolean> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.delete`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'durable_object_storage',
                'db.operation': 'delete',
                'db.key': key,
              },
            },
            async (span) => {
              try {
                const result = await value.call(target, key);
                span.setAttributes({
                  'db.result.deleted': result,
                });
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
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

      // Bind other methods to the target
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  };

  return wrap(storage, storageHandler);
}
