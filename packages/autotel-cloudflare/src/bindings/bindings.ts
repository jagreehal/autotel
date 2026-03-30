/**
 * Auto-instrumentation for Cloudflare Workers bindings
 * 
 * Note: This file uses Cloudflare Workers types (KVNamespace, R2Bucket, D1Database, Fetcher, etc.)
 * which are globally available via @cloudflare/workers-types when listed in tsconfig.json.
 * These types are devDependencies only - they're not runtime dependencies.
 * At runtime, Cloudflare Workers runtime provides the actual implementations.
 * 
 * This module provides automatic tracing for Cloudflare bindings:
 * - KV (key-value operations)
 * - R2 (object storage operations)
 * - D1 (database operations)
 * - Service Bindings
 * - Events Engine
 * - Workers AI
 * - Vectorize
 * - Hyperdrive
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import { WorkerTracer, getActiveConfig } from 'autotel-edge';
import { wrap, isWrapped } from './common';
import { instrumentAI } from './ai';
import { instrumentVectorize } from './vectorize';
import { instrumentHyperdrive } from './hyperdrive';
import { instrumentQueueProducer } from './queue-producer';
import { instrumentAnalyticsEngine } from './analytics-engine';
import { instrumentImages } from './images';

type DbStatementCapture = 'off' | 'obfuscated' | 'full';

/**
 * Sanitize a SQL statement based on the capture mode.
 * - 'full': returns the statement as-is
 * - 'obfuscated': replaces string literals and numbers with '?'
 * - 'off': returns undefined (attribute not set)
 */
function sanitizeStatement(query: string, mode: DbStatementCapture): string | undefined {
  if (mode === 'off') return undefined;
  if (mode === 'obfuscated') return query.replaceAll(/'[^']*'/g, "'?'").replaceAll(/\b\d+\b/g, '?');
  return query;
}

/**
 * Instrument KV namespace
 */
export function instrumentKV<K extends KVNamespace>(kv: K, namespaceName?: string): K {
  const name = namespaceName || 'kv';
  
  const kvHandler: ProxyHandler<K> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      
      if (prop === 'get' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [key, options] = args as [string, KVNamespaceGetOptions<unknown> | undefined];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `KV ${name}: get`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-kv',
                  'db.operation': 'get',
                  'db.namespace': name,
                  'db.key': key,
                  'db.cache_hit': options?.cacheTtl !== undefined,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  span.setAttribute('db.result.type', result === null ? 'null' : typeof result);
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
          },
        });
      }
      
      if (prop === 'put' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] = args as [string, unknown, KVNamespacePutOptions | undefined];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `KV ${name}: put`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-kv',
                  'db.operation': 'put',
                  'db.namespace': name,
                  'db.key': key,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
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
          },
        });
      }
      
      if (prop === 'delete' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] = args as [string];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `KV ${name}: delete`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-kv',
                  'db.operation': 'delete',
                  'db.namespace': name,
                  'db.key': key,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
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
          },
        });
      }
      
      if (prop === 'list' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [options] = args as [KVNamespaceListOptions | undefined];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `KV ${name}: list`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-kv',
                  'db.operation': 'list',
                  'db.namespace': name,
                  'db.prefix': options?.prefix || undefined,
                  'db.limit': options?.limit || undefined,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  span.setAttribute('db.result.keys_count', result.keys.length);
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
          },
        });
      }
      
      return value;
    },
  };
  
  return wrap(kv, kvHandler);
}

/**
 * Instrument R2 bucket
 */
export function instrumentR2<R extends R2Bucket>(r2: R, bucketName?: string): R {
  const name = bucketName || 'r2';
  
  const r2Handler: ProxyHandler<R> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      
      if (prop === 'get' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] = args as [string, R2GetOptions | undefined];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `R2 ${name}: get`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-r2',
                  'db.operation': 'get',
                  'db.bucket': name,
                  'db.key': key,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  if (result) {
                    span.setAttribute('db.result.size', result.size);
                    span.setAttribute('db.result.etag', result.etag);
                    span.setAttribute('db.result.content_type', result.httpMetadata?.contentType);
                  } else {
                    span.setAttribute('db.result.exists', false);
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
          },
        });
      }
      
      if (prop === 'put' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] = args as [string, ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, R2PutOptions | undefined];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `R2 ${name}: put`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-r2',
                  'db.operation': 'put',
                  'db.bucket': name,
                  'db.key': key,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  span.setAttribute('db.result.etag', result.etag);
                  span.setAttribute('db.result.uploaded', result.uploaded);
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
          },
        });
      }
      
      if (prop === 'delete' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const keys = args as string[];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `R2 ${name}: delete`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-r2',
                  'db.operation': 'delete',
                  'db.bucket': name,
                  'db.keys_count': keys.length,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
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
          },
        });
      }
      
      if (prop === 'list' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [options] = args as [R2ListOptions | undefined];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `R2 ${name}: list`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-r2',
                  'db.operation': 'list',
                  'db.bucket': name,
                  'db.prefix': options?.prefix || undefined,
                  'db.limit': options?.limit || undefined,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  span.setAttribute('db.result.objects_count', result.objects.length);
                  span.setAttribute('db.result.truncated', result.truncated);
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
          },
        });
      }
      
      return value;
    },
  };
  
  return wrap(r2, r2Handler);
}

/**
 * Instrument D1 database
 */
export function instrumentD1<D extends D1Database>(d1: D, databaseName?: string): D {
  const name = databaseName || 'd1';
  
  const d1Handler: ProxyHandler<D> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      
      if (prop === 'prepare' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [query] = args as [string];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            const prepared = Reflect.apply(fnTarget, target, args);
            
            // Instrument the prepared statement
            const preparedHandler: ProxyHandler<typeof prepared> = {
              get(target, prop) {
                const value = Reflect.get(target, prop);
                
                if (prop === 'first' || prop === 'run' || prop === 'all' || prop === 'raw') {
                  return new Proxy(value, {
                    apply: (fnTarget, _thisArg, args) => {
                      const activeConfig = getActiveConfig();
                      const captureMode: DbStatementCapture = activeConfig?.dataSafety?.captureDbStatement ?? 'full';
                      const statement = sanitizeStatement(query, captureMode);
                      const attributes: Record<string, any> = {
                        'db.system': 'cloudflare-d1',
                        'db.operation': prop,
                        'db.name': name,
                      };
                      if (statement !== undefined) {
                        attributes['db.statement'] = statement;
                      }
                      return tracer.startActiveSpan(
                        `D1 ${name}: ${prop}`,
                        {
                          kind: SpanKind.CLIENT,
                          attributes,
                        },
                        async (span) => {
                          try {
                            const result = await Reflect.apply(fnTarget, target, args);
                            if (prop === 'all' && Array.isArray(result)) {
                              span.setAttribute('db.result.rows_count', result.length);
                            } else if (prop === 'first' && result) {
                              span.setAttribute('db.result.exists', true);
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
                    },
                  });
                }
                
                return value;
              },
            };
            
            return wrap(prepared, preparedHandler);
          },
        });
      }
      
      if (prop === 'exec' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [query] = args as [string];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;
            const activeConfig = getActiveConfig();
            const captureMode: DbStatementCapture = activeConfig?.dataSafety?.captureDbStatement ?? 'full';
            const statement = sanitizeStatement(query, captureMode);
            const attributes: Record<string, any> = {
              'db.system': 'cloudflare-d1',
              'db.operation': 'exec',
              'db.name': name,
            };
            if (statement !== undefined) {
              attributes['db.statement'] = statement;
            }

            return tracer.startActiveSpan(
              `D1 ${name}: exec`,
              {
                kind: SpanKind.CLIENT,
                attributes,
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  span.setAttribute('db.result.count', result.count);
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
          },
        });
      }
      
      return value;
    },
  };
  
  return wrap(d1, d1Handler);
}

/**
 * Instrument service binding (Fetcher)
 *
 * Unlike other bindings, Fetcher objects are native Cloudflare C++ bindings
 * whose methods throw "Illegal invocation" when called through a Proxy with
 * a different `this` reference. We work around this by calling `target.fetch()`
 * directly on the original binding instead of using `Reflect.apply` on a
 * detached function reference.
 */
export function instrumentServiceBinding<F extends Fetcher>(fetcher: F, serviceName?: string): F {
  const name = serviceName || 'service';

  const fetcherHandler: ProxyHandler<F> = {
    get(target, prop) {
      if (prop === 'fetch' && typeof target.fetch === 'function') {
        // Return a plain function wrapper instead of proxying the native method.
        // This avoids detaching the native method from its binding, which would
        // cause "Illegal invocation" on Cloudflare's native Fetcher objects.
        const tracedFetch = (...args: any[]) => {
          const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
          const request = new Request(input, init);
          const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

          return tracer.startActiveSpan(
            `Service ${name}: ${request.method}`,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'rpc.system': 'cloudflare-service-binding',
                'rpc.service': name,
                'http.request.method': request.method,
                'url.full': request.url,
              },
            },
            async (span) => {
              try {
                // Call fetch directly on the original target to preserve
                // the native `this` binding that Cloudflare requires
                const response = await target.fetch(input, init as RequestInit);
                span.setAttribute('http.response.status_code', response.status);
                span.setStatus({ code: SpanStatusCode.OK });
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
        return tracedFetch;
      }

      // For non-fetch properties, access the original target directly
      // to avoid Proxy-related issues with native bindings
      const value = Reflect.get(target, prop);
      if (typeof value === 'function') {
        // Bind native methods to the original target to prevent
        // "Illegal invocation" errors
        return value.bind(target);
      }
      return value;
    },
  };

  return wrap(fetcher, fetcherHandler);
}

/**
 * Detection helpers
 */
const hasMethod = (obj: any, m: string): boolean =>
  typeof obj?.[m] === 'function';

const hasExactMethods = (obj: any, methods: string[]): boolean =>
  methods.every(m => hasMethod(obj, m));

/**
 * Auto-instrument all Cloudflare bindings in the environment
 *
 * Detection order (most specific first):
 * 1. R2 — get, put, delete, list, head
 * 2. KV — get, put, delete, list (not head)
 * 3. D1 — prepare, exec
 * 4. Vectorize — query, insert, upsert, describe
 * 5. AI — run + (gateway or models discriminator)
 * 6. Hyperdrive — connect + connectionString + host
 * 7. Queue Producer — send, sendBatch (not get)
 * 8. Analytics Engine — writeDataPoint
 * 9. Images — info, input
 * 10. Service Binding — fetch (broadest, must be last)
 *
 * Not auto-detected (manual only):
 * - Rate Limiter — limit() alone too generic
 * - Browser Rendering — indistinguishable from Service Binding
 */
const envCache = new WeakMap<object, Record<string, any>>();

export function instrumentBindings(env: Record<string, any>): Record<string, any> {
  const cached = envCache.get(env);
  if (cached) return cached;

  const instrumented: Record<string, any> = {};

  for (const [key, value] of Object.entries(env)) {
    if (!value || typeof value !== 'object') {
      instrumented[key] = value;
      continue;
    }

    // Skip already-instrumented bindings
    if (isWrapped(value)) {
      instrumented[key] = value;
      continue;
    }

    // 1. R2 — most specific (has head)
    if (hasExactMethods(value, ['get', 'put', 'delete', 'list', 'head'])) {
      instrumented[key] = instrumentR2(value as R2Bucket, key);
      continue;
    }

    // 2. KV — like R2 but without head
    if (hasExactMethods(value, ['get', 'put', 'delete', 'list']) && !('head' in value)) {
      instrumented[key] = instrumentKV(value as KVNamespace, key);
      continue;
    }

    // 3. D1
    if (hasExactMethods(value, ['prepare', 'exec'])) {
      instrumented[key] = instrumentD1(value as D1Database, key);
      continue;
    }

    // 4. Vectorize
    if (hasExactMethods(value, ['query', 'insert', 'upsert', 'describe'])) {
      instrumented[key] = instrumentVectorize(value as VectorizeIndex, key);
      continue;
    }

    // 5. AI — has run() + discriminator properties
    if (hasMethod(value, 'run') && ('gateway' in value || 'models' in value)) {
      instrumented[key] = instrumentAI(value as Ai, key);
      continue;
    }

    // 6. Hyperdrive — connect + connection properties
    if (hasMethod(value, 'connect') && 'connectionString' in value && 'host' in value) {
      instrumented[key] = instrumentHyperdrive(value as Hyperdrive, key);
      continue;
    }

    // 7. Queue Producer — send + sendBatch (not get, to avoid KV collision)
    if (hasExactMethods(value, ['send', 'sendBatch']) && !('get' in value)) {
      instrumented[key] = instrumentQueueProducer(value as Queue, key);
      continue;
    }

    // 8. Analytics Engine
    if (hasMethod(value, 'writeDataPoint')) {
      instrumented[key] = instrumentAnalyticsEngine(value as AnalyticsEngineDataset, key);
      continue;
    }

    // 9. Images
    if (hasExactMethods(value, ['info', 'input'])) {
      instrumented[key] = instrumentImages(value as any, key);
      continue;
    }

    // 10. Service Binding (broadest — must be last)
    if (hasMethod(value, 'fetch')) {
      instrumented[key] = instrumentServiceBinding(value as Fetcher, key);
      continue;
    }

    // Unknown binding type — pass through
    instrumented[key] = value;
  }

  envCache.set(env, instrumented);
  return instrumented;
}

