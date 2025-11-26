/**
 * Actor sockets instrumentation
 *
 * Traces operations on actor.sockets
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
 * Instrument Actor sockets for tracing
 *
 * Captures:
 * - acceptWebSocket: Accept an incoming WebSocket connection
 * - broadcast: Send message to all connected sockets
 * - send: Send message to a specific socket
 */
export function instrumentActorSockets(
  sockets: unknown,
  actorInstance: ActorLike,
  actorClass: object,
): unknown {
  if (!sockets || typeof sockets !== 'object') {
    return sockets;
  }

  const actorClassName = (actorClass as { name?: string }).name || 'Actor';
  const actorName = actorInstance.name || actorClassName;

  const socketsHandler: ProxyHandler<object> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Instrument acceptWebSocket method
      if (prop === 'acceptWebSocket' && typeof value === 'function') {
        return function instrumentedAcceptWebSocket(
          this: unknown,
          request: Request,
        ): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.acceptWebSocket`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.SERVER,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'accept',
                'url.full': request.url,
              },
            },
            (span) => {
              try {
                const result = value.call(target, request);
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

      // Instrument broadcast method
      if (prop === 'broadcast' && typeof value === 'function') {
        return function instrumentedBroadcast(this: unknown, message: unknown): void {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.broadcast`;

          tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.PRODUCER,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'broadcast',
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
                value.call(target, message);
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

      // Instrument send method
      if (prop === 'send' && typeof value === 'function') {
        return function instrumentedSend(this: unknown, ws: WebSocket, message: unknown): void {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.send`;

          tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.PRODUCER,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'send',
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
                value.call(target, ws, message);
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

      // Instrument getConnections method (if exists)
      if (prop === 'getConnections' && typeof value === 'function') {
        return function instrumentedGetConnections(this: unknown): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.getConnections`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'getConnections',
              },
            },
            (span) => {
              try {
                const result = value.call(target);
                // Try to capture connection count if result is array-like
                if (Array.isArray(result)) {
                  span.setAttribute('websocket.connections.count', result.length);
                }
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

  return wrap(sockets, socketsHandler);
}
