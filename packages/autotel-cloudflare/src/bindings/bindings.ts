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

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { getActiveConfig } from 'autotel-edge';
import { wrap, isWrapped } from './common';
import { instrumentAI } from './ai';
import { instrumentVectorize } from './vectorize';
import { instrumentHyperdrive } from './hyperdrive';
import { instrumentQueueProducer } from './queue-producer';
import { instrumentAnalyticsEngine } from './analytics-engine';
import { instrumentImages } from './images';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import type { UnknownRecord } from '../values.js';
import {
  asBoolean,
  asFunction,
  asNumber,
  asRecord,
  asString,
  hasMethod,
  hasMethods,
  member,
  numberAt,
  readPath,
  readProperty,
  trapArgs,
} from '../values.js';

type DbStatementCapture = 'off' | 'obfuscated' | 'full';

/**
 * Sanitize a SQL statement based on the capture mode.
 * - 'full': returns the statement as-is
 * - 'obfuscated': replaces string literals and numbers with '?'
 * - 'off': returns undefined (attribute not set)
 */
function sanitizeStatement(
  query: string,
  mode: DbStatementCapture,
): string | undefined {
  if (mode === 'off') return undefined;
  if (mode === 'obfuscated')
    return query.replaceAll(/'[^']*'/g, "'?'").replaceAll(/\b\d+\b/g, '?');
  return query;
}

/**
 * Instrument KV namespace
 */
export function instrumentKV<K extends KVNamespace>(
  kv: K,
  namespaceName?: string,
): K {
  const name = namespaceName || 'kv';

  const kvHandler: ProxyHandler<K> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'get' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [key, options] =
              trapArgs<[string, KVNamespaceGetOptions<unknown> | undefined]>(
                args,
              );
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  span.setAttribute(
                    'db.result.type',
                    result === null ? 'null' : typeof result,
                  );
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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

      if (prop === 'put' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] =
              trapArgs<[string, unknown, KVNamespacePutOptions | undefined]>(
                args,
              );
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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

      if (prop === 'delete' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] = trapArgs<[string]>(args);
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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

      if (prop === 'list' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [options] =
              trapArgs<[KVNamespaceListOptions | undefined]>(args);
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  const keys = readProperty(result, 'keys');
                  if (Array.isArray(keys)) {
                    span.setAttribute('db.result.keys_count', keys.length);
                  }
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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
export function instrumentR2<R extends R2Bucket>(
  r2: R,
  bucketName?: string,
): R {
  const name = bucketName || 'r2';

  const r2Handler: ProxyHandler<R> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'get' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] = trapArgs<[string, R2GetOptions | undefined]>(args);
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  if (result) {
                    setResultAttr(span, 'db.result.size', result, 'size');
                    setResultAttr(span, 'db.result.etag', result, 'etag');
                    const contentType = asString(
                      readPath(result, 'httpMetadata', 'contentType'),
                    );
                    if (contentType !== undefined) {
                      span.setAttribute('db.result.content_type', contentType);
                    }
                  } else {
                    span.setAttribute('db.result.exists', false);
                  }
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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

      if (prop === 'put' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [key] =
              trapArgs<
                [
                  string,
                  (
                    | ReadableStream
                    | ArrayBuffer
                    | ArrayBufferView
                    | string
                    | null
                    | Blob
                  ),
                  R2PutOptions | undefined,
                ]
              >(args);
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  setResultAttr(span, 'db.result.etag', result, 'etag');
                  setResultAttr(span, 'db.result.uploaded', result, 'uploaded');
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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

      if (prop === 'delete' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const keys = args as string[];
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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

      if (prop === 'list' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [options] = trapArgs<[R2ListOptions | undefined]>(args);
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  const objects = readProperty(result, 'objects');
                  if (Array.isArray(objects)) {
                    span.setAttribute(
                      'db.result.objects_count',
                      objects.length,
                    );
                  }
                  setResultAttr(
                    span,
                    'db.result.truncated',
                    result,
                    'truncated',
                  );
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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
export function instrumentD1<D extends D1Database>(
  d1: D,
  databaseName?: string,
): D {
  const name = databaseName || 'd1';

  const d1Handler: ProxyHandler<D> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'prepare' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [query] = trapArgs<[string]>(args);
            const tracer = workerTracer('autotel-edge');

            // SAFETY: `prepare` returns the prepared statement this proxy
            // then instruments; only its own methods are read below.
            const prepared = fnTarget.apply(target, args) as object;

            // Instrument the prepared statement
            const preparedHandler: ProxyHandler<object> = {
              get(target, prop) {
                const value = member(target, prop);
                const method = asFunction(value);

                if (
                  method &&
                  (prop === 'first' ||
                    prop === 'run' ||
                    prop === 'all' ||
                    prop === 'raw')
                ) {
                  return new Proxy(method, {
                    apply: (fnTarget, _thisArg, args) => {
                      const activeConfig = getActiveConfig();
                      const captureMode: DbStatementCapture =
                        activeConfig?.dataSafety?.captureDbStatement ?? 'full';
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
                            const result = await fnTarget.apply(target, args);
                            if (prop === 'all' && Array.isArray(result)) {
                              span.setAttribute(
                                'db.result.rows_count',
                                result.length,
                              );
                            } else if (prop === 'first' && result) {
                              span.setAttribute('db.result.exists', true);
                            }
                            span.setStatus({ code: SpanStatusCode.OK });
                            return result;
                          } catch (error) {
                            span.recordException(toException(error));
                            span.setStatus({
                              code: SpanStatusCode.ERROR,
                              message:
                                error instanceof Error
                                  ? error.message
                                  : String(error),
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

      if (prop === 'exec' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [query] = trapArgs<[string]>(args);
            const tracer = workerTracer('autotel-edge');
            const activeConfig = getActiveConfig();
            const captureMode: DbStatementCapture =
              activeConfig?.dataSafety?.captureDbStatement ?? 'full';
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
                  const result = await fnTarget.apply(target, args);
                  const count = numberAt(result, 'count');
                  if (count !== undefined) {
                    span.setAttribute('db.result.count', count);
                  }
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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
 * directly on the original binding instead of using `fn.apply` on a
 * detached function reference.
 */
export function instrumentServiceBinding<F extends Fetcher>(
  fetcher: F,
  serviceName?: string,
): F {
  const name = serviceName || 'service';

  const fetcherHandler: ProxyHandler<F> = {
    get(target, prop) {
      if (prop === 'fetch' && typeof target.fetch === 'function') {
        // Return a plain function wrapper instead of proxying the native method.
        // This avoids detaching the native method from its binding, which would
        // cause "Illegal invocation" on Cloudflare's native Fetcher objects.
        const tracedFetch = (...args: any[]) => {
          const [input, init] =
            trapArgs<[RequestInfo | URL, RequestInit | undefined]>(args);
          const request = new Request(input, init);
          const tracer = workerTracer('autotel-edge');

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
                span.recordException(toException(error));
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message:
                    error instanceof Error ? error.message : String(error),
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
      const value = member(target, prop);
      const method = asFunction(value);
      if (method !== undefined) {
        // Bind native methods to the original target to prevent
        // "Illegal invocation" errors
        return method.bind(target);
      }
      return value;
    },
  };

  return wrap(fetcher, fetcherHandler);
}

/**
 * Detection helpers - a binding is recognised by the methods it carries.
 */
const hasExactMethods = (obj: unknown, methods: string[]): boolean =>
  hasMethods(obj, methods);

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
const envCache = new WeakMap<object, WorkerEnv>();

/**
 * One Worker binding, read as the type its method set identifies it as.
 *
 * SAFETY: each call below has just checked the exact set of methods that
 * distinguishes one binding kind from every other, in the documented order
 * (R2 before KV because R2 also has `head`, service bindings last because
 * `fetch` is the broadest). The wrapper that receives it calls only the
 * methods that check just found.
 */
/** Set an attribute from a result field, when the result carries one there. */
function setResultAttr(
  span: Span,
  attribute: string,
  result: unknown,
  key: string,
): void {
  const value = readProperty(result, key);
  const attributeValue = asString(value) ?? asNumber(value) ?? asBoolean(value);
  if (attributeValue !== undefined)
    span.setAttribute(attribute, attributeValue);
}

function asBinding<TBinding>(value: object): TBinding {
  return value as TBinding;
}

/** A Worker's environment: bindings by the names wrangler.toml gave them. */
export type WorkerEnv = UnknownRecord;

/** A binding is an object; anything else in env is a plain config value. */
function asObjectBinding(value: unknown): object | undefined {
  return asRecord(value);
}

export function instrumentBindings(env: WorkerEnv): WorkerEnv {
  const cached = envCache.get(env);
  if (cached) return cached;

  const instrumented: WorkerEnv = {};

  for (const [key, entry] of Object.entries(env)) {
    const value = asObjectBinding(entry);
    if (!value) {
      instrumented[key] = entry;
      continue;
    }

    // Skip already-instrumented bindings
    if (isWrapped(value)) {
      instrumented[key] = value;
      continue;
    }

    // 1. R2 — most specific (has head)
    if (hasExactMethods(value, ['get', 'put', 'delete', 'list', 'head'])) {
      instrumented[key] = instrumentR2(asBinding<R2Bucket>(value), key);
      continue;
    }

    // 2. KV — like R2 but without head
    if (
      hasExactMethods(value, ['get', 'put', 'delete', 'list']) &&
      !('head' in value)
    ) {
      instrumented[key] = instrumentKV(asBinding<KVNamespace>(value), key);
      continue;
    }

    // 3. D1
    if (hasExactMethods(value, ['prepare', 'exec'])) {
      instrumented[key] = instrumentD1(asBinding<D1Database>(value), key);
      continue;
    }

    // 4. Vectorize
    if (hasExactMethods(value, ['query', 'insert', 'upsert', 'describe'])) {
      instrumented[key] = instrumentVectorize(
        asBinding<VectorizeIndex>(value),
        key,
      );
      continue;
    }

    // 5. AI — has run() + discriminator properties
    if (hasMethod(value, 'run') && ('gateway' in value || 'models' in value)) {
      instrumented[key] = instrumentAI(asBinding<Ai>(value), key);
      continue;
    }

    // 6. Hyperdrive — connect + connection properties
    if (
      hasMethod(value, 'connect') &&
      'connectionString' in value &&
      'host' in value
    ) {
      instrumented[key] = instrumentHyperdrive(
        asBinding<Hyperdrive>(value),
        key,
      );
      continue;
    }

    // 7. Queue Producer — send + sendBatch (not get, to avoid KV collision)
    if (hasExactMethods(value, ['send', 'sendBatch']) && !('get' in value)) {
      instrumented[key] = instrumentQueueProducer(asBinding<Queue>(value), key);
      continue;
    }

    // 8. Analytics Engine
    if (hasMethod(value, 'writeDataPoint')) {
      instrumented[key] = instrumentAnalyticsEngine(
        asBinding<AnalyticsEngineDataset>(value),
        key,
      );
      continue;
    }

    // 9. Images
    if (hasExactMethods(value, ['info', 'input'])) {
      instrumented[key] = instrumentImages(asBinding(value), key);
      continue;
    }

    // 10. Service Binding (broadest — must be last)
    if (hasMethod(value, 'fetch')) {
      instrumented[key] = instrumentServiceBinding(
        asBinding<Fetcher>(value),
        key,
      );
      continue;
    }

    // Unknown binding type — pass through
    instrumented[key] = value;
  }

  envCache.set(env, instrumented);
  return instrumented;
}
