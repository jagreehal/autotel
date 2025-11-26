/**
 * Global fetch() instrumentation for autotel-edge
 *
 * Automatically traces all outgoing fetch() calls with:
 * - HTTP method, URL, status code
 * - Request/response headers
 * - Automatic context propagation
 * - Error tracking
 */

import {
  trace,
  context as api_context,
  propagation,
  SpanStatusCode,
  SpanKind,
} from '@opentelemetry/api';
import { getActiveConfig, WorkerTracer } from 'autotel-edge';

/**
 * Gather HTTP request attributes following OpenTelemetry semantic conventions
 */
function gatherRequestAttributes(request: Request): Record<string, any> {
  const url = new URL(request.url);

  return {
    'http.request.method': request.method.toUpperCase(),
    'url.full': request.url,
    'url.scheme': url.protocol.replace(':', ''),
    'server.address': url.host,
    'url.path': url.pathname,
    'url.query': url.search,
    'network.protocol.name': 'http',
    'user_agent.original': request.headers.get('user-agent') || undefined,
  };
}

/**
 * Gather HTTP response attributes
 */
function gatherResponseAttributes(response: Response): Record<string, any> {
  return {
    'http.response.status_code': response.status,
    'http.response.body.size': response.headers.get('content-length') || undefined,
  };
}

/**
 * Instrument the global fetch function
 *
 * This wraps globalThis.fetch to automatically create spans for all outgoing HTTP requests.
 *
 * **Note:** This is called automatically when the library is initialized with
 * `instrumentation.instrumentGlobalFetch: true` (default).
 */
export function instrumentGlobalFetch(): void {
  const originalFetch = globalThis.fetch;

  const instrumentedFetch = function fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);

    // Skip non-HTTP requests
    if (!request.url.startsWith('http')) {
      return originalFetch(input, init);
    }

    // Skip if no active config (not initialized yet)
    const config = getActiveConfig();
    if (!config) {
      return originalFetch(input, init);
    }

    const tracer = trace.getTracer('autotel-edge') as WorkerTracer;
    const url = new URL(request.url);
    const spanName = `${request.method} ${url.host}`;

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.CLIENT,
        attributes: gatherRequestAttributes(request),
      },
      async (span) => {
        try {
          // Inject trace context into request headers for distributed tracing
          const shouldIncludeContext =
            typeof config.fetch?.includeTraceContext === 'function'
              ? config.fetch.includeTraceContext(request)
              : (config.fetch?.includeTraceContext ?? true);

          if (shouldIncludeContext) {
            propagation.inject(api_context.active(), request.headers, {
              set: (headers, key, value) => {
                if (typeof value === 'string') {
                  headers.set(key, value);
                }
              },
            });
          }

          // Make the actual fetch call
          const response = await originalFetch(request);

          // Add response attributes
          span.setAttributes(gatherResponseAttributes(response));

          // Set span status based on response
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

  // Replace global fetch
  globalThis.fetch = instrumentedFetch as typeof fetch;
}
