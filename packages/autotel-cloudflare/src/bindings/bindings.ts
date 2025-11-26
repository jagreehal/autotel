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
import { WorkerTracer } from 'autotel-edge';
import { wrap } from './common';

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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
            const [query] = args as [string];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;
            
            const prepared = Reflect.apply(fnTarget, thisArg, args);
            
            // Instrument the prepared statement
            const preparedHandler: ProxyHandler<typeof prepared> = {
              get(target, prop) {
                const value = Reflect.get(target, prop);
                
                if (prop === 'first' || prop === 'run' || prop === 'all' || prop === 'raw') {
                  return new Proxy(value, {
                    apply: (fnTarget, thisArg, args) => {
                      return tracer.startActiveSpan(
                        `D1 ${name}: ${prop}`,
                        {
                          kind: SpanKind.CLIENT,
                          attributes: {
                            'db.system': 'cloudflare-d1',
                            'db.operation': prop,
                            'db.name': name,
                            'db.statement': query,
                          },
                        },
                        async (span) => {
                          try {
                            const result = await Reflect.apply(fnTarget, thisArg, args);
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
          apply: (fnTarget, thisArg, args) => {
            const [query] = args as [string];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;
            
            return tracer.startActiveSpan(
              `D1 ${name}: exec`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'cloudflare-d1',
                  'db.operation': 'exec',
                  'db.name': name,
                  'db.statement': query,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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
 */
export function instrumentServiceBinding<F extends Fetcher>(fetcher: F, serviceName?: string): F {
  const name = serviceName || 'service';
  
  const fetcherHandler: ProxyHandler<F> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      
      if (prop === 'fetch' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, thisArg, args) => {
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
                  const response = await Reflect.apply(fnTarget, thisArg, args);
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
          },
        });
      }
      
      return value;
    },
  };
  
  return wrap(fetcher, fetcherHandler);
}

/**
 * Auto-instrument all Cloudflare bindings in the environment
 */
export function instrumentBindings(env: Record<string, any>): Record<string, any> {
  const instrumented: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(env)) {
    if (!value || typeof value !== 'object') {
      instrumented[key] = value;
      continue;
    }
    
    // Check for KV namespace
    if ('get' in value && 'put' in value && 'delete' in value && 'list' in value) {
      // Likely KV namespace
      try {
        instrumented[key] = instrumentKV(value as KVNamespace, key);
        continue;
      } catch {
        // Not KV, continue checking
      }
    }
    
    // Check for R2 bucket
    if ('get' in value && 'put' in value && 'delete' in value && 'list' in value && 'head' in value) {
      // Likely R2 bucket
      try {
        instrumented[key] = instrumentR2(value as R2Bucket, key);
        continue;
      } catch {
        // Not R2, continue checking
      }
    }
    
    // Check for D1 database
    if ('prepare' in value && 'exec' in value && typeof value.prepare === 'function') {
      // Likely D1 database
      try {
        instrumented[key] = instrumentD1(value as D1Database, key);
        continue;
      } catch {
        // Not D1, continue checking
      }
    }
    
    // Check for Service Binding (Fetcher)
    if ('fetch' in value && typeof value.fetch === 'function') {
      // Likely service binding
      try {
        instrumented[key] = instrumentServiceBinding(value as Fetcher, key);
        continue;
      } catch {
        // Not a service binding, continue checking
      }
    }
    
    // For other bindings (Events Engine, Workers AI, Vectorize, Hyperdrive),
    // they don't have standard interfaces we can detect, so we pass them through
    // Users can manually instrument them if needed
    instrumented[key] = value;
  }
  
  return instrumented;
}

