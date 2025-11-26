/**
 * HTTP Instrumentation Helpers
 *
 * Optional import: Not included in main bundle
 * Import from: 'autotel/http'
 *
 * Provides decorators and utilities for HTTP client instrumentation.
 * Works with fetch, axios, and other HTTP clients.
 *
 * @example
 * ```typescript
 * import { HttpInstrumented } from 'autotel/http'
 *
 * @HttpInstrumented()
 * class ApiClient {
 *   async getUser(id: string) {
 *     return fetch(`/api/users/${id}`)
 *   }
 * }
 * ```
 */

import { SpanStatusCode, context, propagation } from '@opentelemetry/api';
import { getConfig } from './config';
import { getActiveContextWithBaggage } from './trace-context';

export interface HttpInstrumentedOptions {
  /** Service name for HTTP calls (default: 'http-client') */
  serviceName?: string;
  /** Extract URL from method arguments (default: first arg) */
  urlExtractor?: (args: unknown[]) => string | undefined;
  /** Extract HTTP method from method name or args */
  methodExtractor?: (methodName: string, args: unknown[]) => string;
  /** Add custom attributes to spans */
  attributesFromArgs?: (args: unknown[]) => Record<string, string | number>;
  /** Slow request threshold in milliseconds (adds warning attribute) - default: 3000ms */
  slowRequestThresholdMs?: number;
}

/**
 * Decorator for auto-instrumenting HTTP client methods
 *
 * @example Basic usage
 * ```typescript
 * @HttpInstrumented()
 * class ApiClient {
 *   async fetchUser(userId: string) {
 *     const res = await fetch(`https://api.example.com/users/${userId}`)
 *     return res.json()
 *   }
 *
 *   async createOrder(order: Order) {
 *     const res = await fetch('https://api.example.com/orders', {
 *       method: 'POST',
 *       body: JSON.stringify(order)
 *     })
 *     return res.json()
 *   }
 * }
 * ```
 *
 * @example Advanced usage with custom extractors
 * ```typescript
 * @HttpInstrumented({
 *   serviceName: 'payment-gateway',
 *   urlExtractor: (args) => {
 *     const config = args[0] as RequestConfig
 *     return config.url
 *   },
 *   attributesFromArgs: (args) => ({
 *     'http.request_id': args[0]?.requestId,
 *     'http.retry_count': args[0]?.retryCount || 0
 *   })
 * })
 * class PaymentClient {
 *   async charge(config: RequestConfig) {
 *     return axios(config)
 *   }
 * }
 * ```
 */
export function HttpInstrumented(options: HttpInstrumentedOptions = {}) {
  const serviceName = options.serviceName || 'http-client';
  const slowRequestThresholdMs = options.slowRequestThresholdMs ?? 3000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  return function <T extends { new (...args: any[]): {} }>(
    target: T,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ClassDecoratorContext,
  ) {
    return class extends target {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        super(...args);

        const proto = target.prototype;
        const methodNames = Object.getOwnPropertyNames(proto).filter(
          (name) =>
            name !== 'constructor' &&
            typeof proto[name] === 'function' &&
            !name.startsWith('_'),
        );

        for (const methodName of methodNames) {
          const originalMethod = proto[methodName];

          if (
            originalMethod.constructor.name === 'AsyncFunction' ||
            originalMethod.toString().startsWith('async ')
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const wrappedMethod = async (...args: any[]) => {
              const config = getConfig();
              const tracer = config.tracer;

              const url = options.urlExtractor
                ? options.urlExtractor(args)
                : (args[0] as string | undefined);

              const method = options.methodExtractor
                ? options.methodExtractor(methodName, args)
                : inferHttpMethod(methodName);

              const spanName = url
                ? `HTTP ${method} ${extractPath(url)}`
                : `HTTP ${method}`;

              return tracer.startActiveSpan(spanName, async (span) => {
                const startTime = performance.now();

                try {
                  span.setAttributes({
                    'http.method': method,
                    'http.url': url || 'unknown',
                    'service.name': serviceName,
                    'operation.name': `${serviceName}.${methodName}`,
                  });

                  if (url) {
                    const urlObj = parseUrl(url);
                    span.setAttributes({
                      'http.scheme': urlObj.protocol,
                      'http.host': urlObj.host,
                      'http.target': urlObj.path,
                    });
                  }

                  if (options.attributesFromArgs) {
                    span.setAttributes(options.attributesFromArgs(args));
                  }

                  const result = await originalMethod.apply(this, args);

                  const duration = performance.now() - startTime;

                  // Extract status code from response
                  const statusCode = extractStatusCode(result);
                  if (statusCode) {
                    span.setAttribute('http.status_code', statusCode);

                    if (statusCode >= 400) {
                      span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: `HTTP ${statusCode}`,
                      });
                    } else {
                      span.setStatus({ code: SpanStatusCode.OK });
                    }
                  } else {
                    span.setStatus({ code: SpanStatusCode.OK });
                  }

                  span.setAttributes({
                    'http.duration_ms': duration,
                  });

                  // Mark slow requests for investigation
                  if (duration > slowRequestThresholdMs) {
                    span.setAttribute('http.slow_request', true);
                    span.setAttribute(
                      'http.slow_request_threshold_ms',
                      slowRequestThresholdMs,
                    );
                  }

                  return result;
                } catch (error) {
                  const duration = performance.now() - startTime;

                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : 'Unknown error',
                  });

                  span.setAttributes({
                    'http.duration_ms': duration,
                    'error.type':
                      error instanceof Error
                        ? error.constructor.name
                        : 'Unknown',
                    'error.message':
                      error instanceof Error ? error.message : 'Unknown error',
                  });

                  throw error;
                } finally {
                  span.end();
                }
              });
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any)[methodName] = wrappedMethod;
          }
        }
      }
    };
  };
}

/**
 * Helper: Trace a single HTTP request
 *
 * @example
 * ```typescript
 * import { traceHttpRequest } from 'autotel/http'
 *
 * const data = await traceHttpRequest(
 *   'GET /api/users',
 *   () => fetch('https://api.example.com/users')
 * )
 * ```
 */
export async function traceHttpRequest<T>(
  spanName: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number>,
): Promise<T> {
  const config = getConfig();
  const tracer = config.tracer;

  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      if (attributes) {
        span.setAttributes(attributes);
      }

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

// Helper functions

function inferHttpMethod(methodName: string): string {
  const lower = methodName.toLowerCase();
  if (
    lower.includes('get') ||
    lower.includes('fetch') ||
    lower.includes('list')
  )
    return 'GET';
  if (lower.includes('post') || lower.includes('create')) return 'POST';
  if (lower.includes('put') || lower.includes('update')) return 'PUT';
  if (lower.includes('delete') || lower.includes('remove')) return 'DELETE';
  if (lower.includes('patch')) return 'PATCH';
  return 'GET'; // Default
}

function extractPath(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch {
    // Relative URL or invalid
    return url.split('?')[0] || url;
  }
}

function parseUrl(url: string): {
  protocol: string;
  host: string;
  path: string;
} {
  try {
    const urlObj = new URL(url);
    return {
      protocol: urlObj.protocol.replace(':', ''),
      host: urlObj.host,
      path: urlObj.pathname + urlObj.search,
    };
  } catch {
    return {
      protocol: 'http',
      host: 'unknown',
      path: url,
    };
  }
}

function extractStatusCode(result: unknown): number | undefined {
  if (result && typeof result === 'object') {
    // Check for Response.status (fetch API)
    if ('status' in result && typeof result.status === 'number') {
      return result.status;
    }
    // Check for statusCode (axios, node http)
    if ('statusCode' in result && typeof result.statusCode === 'number') {
      return result.statusCode;
    }
  }
  return undefined;
}

/**
 * Inject trace context into HTTP headers (for distributed tracing)
 *
 * This includes W3C Trace Context (traceparent, tracestate) and W3C Baggage headers.
 * Uses OpenTelemetry's propagation system for full compatibility.
 *
 * @example
 * ```typescript
 * import { injectTraceContext } from 'autotel/http'
 *
 * const headers = injectTraceContext({
 *   'Content-Type': 'application/json'
 * })
 *
 * fetch('/api/users', { headers })
 * ```
 *
 * @example With baggage
 * ```typescript
 * import { trace, withBaggage, injectTraceContext } from 'autotel'
 *
 * export const createOrder = trace((ctx) => async (order: Order) => {
 *   return await withBaggage({
 *     baggage: { 'tenant.id': order.tenantId },
 *     fn: async () => {
 *       const headers = injectTraceContext();
 *       // Headers now include 'baggage' header with tenant.id
 *       await fetch('/api/charge', { headers });
 *     },
 *   });
 * });
 * ```
 */
export function injectTraceContext(
  headers: Record<string, string> = {},
): Record<string, string> {
  // Use getActiveContextWithBaggage to check stored context (from baggage setters)
  // This ensures ctx.setBaggage() changes are included in injected headers
  const currentContext = getActiveContextWithBaggage();

  // Use OpenTelemetry's propagation.inject for full W3C support
  // This includes traceparent, tracestate, and baggage headers
  propagation.inject(currentContext, headers);

  return headers;
}

/**
 * Extract trace context from HTTP headers (for distributed tracing)
 *
 * This extracts W3C Trace Context (traceparent, tracestate) and W3C Baggage headers.
 * Uses OpenTelemetry's propagation system for full compatibility.
 *
 * Returns a context that can be used with context.with() to run code
 * with the extracted trace context and baggage.
 *
 * @example
 * ```typescript
 * import { extractTraceContext, trace } from 'autotel'
 * import { context } from 'autotel'
 *
 * // In Express middleware
 * app.use((req, res, next) => {
 *   const extractedContext = extractTraceContext(req.headers);
 *   context.with(extractedContext, () => {
 *     next();
 *   });
 * });
 * ```
 *
 * @example In a traced function
 * ```typescript
 * export const handleWebhook = trace((ctx) => async (req: Request) => {
 *   const extractedContext = extractTraceContext(req.headers);
 *   return await context.with(extractedContext, async () => {
 *     // Now ctx.getBaggage() will return baggage from the incoming request
 *     const tenantId = ctx.getBaggage('tenant.id');
 *     await processWebhook(req.body);
 *   });
 * });
 * ```
 */
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>,
): ReturnType<typeof context.active> {
  const carrier: Record<string, string> = {};

  // Convert headers to flat string format expected by propagation
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      carrier[key] = Array.isArray(value) ? (value[0] ?? '') : value;
    }
  }

  // Extract context using OpenTelemetry's propagation system
  // Returns a Context that can be used with context.with()
  return propagation.extract(context.active(), carrier);
}
