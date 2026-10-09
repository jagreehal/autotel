import type { Span, Tracer } from 'autotel';
import {
  getTracer,
  getMeter,
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  HTTPAttributes,
  URLAttributes,
  ServiceAttributes,
  httpRequestHeaderAttribute,
  httpResponseHeaderAttribute,
} from 'autotel';
import type { MiddlewareHandler, Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import {
  createRequestDurationTracker,
  createActiveRequestsTracker,
  type HttpMetricsConfig,
} from './metrics';

const INSTRUMENTATION_SCOPE_NAME = 'autotel-hono';

type TimeInput = number | [number, number];
type TracerProvider = { getTracer(name: string, version?: string): Tracer };
type Meter = HttpMetricsConfig['meter'];
type MeterProvider = { getMeter(name: string, version?: string): Meter };

function now(): number {
  // Workers and browsers have performance.now(); older Node targets may not.
  return globalThis.performance?.now() ?? Date.now();
}

export type OtelConfig = {
  tracer?: Tracer;
  tracerProvider?: TracerProvider;
  meter?: Meter;
  meterProvider?: MeterProvider;
  tracerName?: string;
  spanNameFactory?: (c: Context) => string;
  captureRequestHeaders?: string[];
  captureResponseHeaders?: string[];
  captureActiveRequests?: boolean;
  captureRequestDuration?: boolean;
  serviceName?: string;
  serviceVersion?: string;
  disableTracing?: boolean;
  getTime?(): TimeInput;
};

type NormalizedOtelConfig = OtelConfig & {
  requestHeaderSet: Set<string>;
  responseHeaderSet: Set<string>;
  captureActiveRequests: boolean;
  captureRequestDuration: boolean;
};

function normalizeConfig(config: OtelConfig = {}): NormalizedOtelConfig {
  const reqHeadersSrc = [...(config.captureRequestHeaders ?? [])];
  const resHeadersSrc = [...(config.captureResponseHeaders ?? [])];
  const requestHeaderSet = new Set(reqHeadersSrc.map((h) => h.toLowerCase()));
  const responseHeaderSet = new Set(resHeadersSrc.map((h) => h.toLowerCase()));
  return {
    ...config,
    requestHeaderSet,
    responseHeaderSet,
    captureActiveRequests: config.captureActiveRequests ?? true,
    captureRequestDuration: config.captureRequestDuration ?? true,
  };
}

function resolveTracer(config: NormalizedOtelConfig): Tracer | undefined {
  if (config.disableTracing) return undefined;
  if (config.tracer) return config.tracer;
  if (config.tracerProvider) {
    return config.tracerProvider.getTracer(
      config.tracerName ?? INSTRUMENTATION_SCOPE_NAME,
      config.serviceVersion,
    );
  }
  return getTracer(
    config.tracerName ?? INSTRUMENTATION_SCOPE_NAME,
    config.serviceVersion,
  );
}

function resolveMeter(config: NormalizedOtelConfig): Meter {
  if (config.meter) return config.meter;
  if (config.meterProvider) {
    return config.meterProvider.getMeter(
      INSTRUMENTATION_SCOPE_NAME,
      config.serviceVersion,
    );
  }
  return getMeter();
}

/**
 * Swap in a pass-through body that calls `onEnd` once: when the body has been
 * fully sent, errors, or the client goes away. That is when the request ends
 * for a streamed body (`stream`, `streamSSE`, AI SDK UI streams) and, a moment
 * after the handler returns, for a buffered one; the headers cannot tell the
 * two apart, since Hono's `stream()` sets none.
 *
 * Returns false, changing nothing, when there is no body to wait for: a null
 * body, an error, or HEAD, whose body Hono discards unread.
 */
function onBodyEnd(c: Context, onEnd: (cause?: unknown) => void): boolean {
  if (c.error || !c.res.body || c.req.method === 'HEAD') return false;
  let ended = false;
  const end = (cause?: unknown) => {
    if (ended) return;
    ended = true;
    onEnd(cause);
  };
  const res = c.res;
  const reader = res.body!.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          end();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        end(error);
      }
    },
    cancel(reason) {
      end();
      return reader.cancel(reason);
    },
  });
  c.res = new Response(body, res);
  return true;
}

export function otel(userConfig: OtelConfig = {}): MiddlewareHandler {
  const config = normalizeConfig(userConfig);
  const tracer = resolveTracer(config);
  const meter = resolveMeter(config);

  const metricsConfig: HttpMetricsConfig = {
    meter,
    captureRequestDuration: config.captureRequestDuration,
    captureActiveRequests: config.captureActiveRequests,
  };
  const requestDuration = createRequestDurationTracker(metricsConfig);
  const activeReqs = createActiveRequestsTracker(metricsConfig);

  const spanName = (c: Context) =>
    config.spanNameFactory?.(c) ?? `${c.req.method} ${routePath(c)}`;

  return createMiddleware(async (c, next) => {
    const method = c.req.method;

    const stableAttrs = {
      [HTTPAttributes.requestMethod]: method,
      [ServiceAttributes.name]: config.serviceName,
      [ServiceAttributes.version]: config.serviceVersion,
    };

    activeReqs?.increment(stableAttrs);
    const startTime = now();

    const deferredRequestHeaderAttributes: Record<string, string> = {};
    const reqHeaders = c.req.raw.headers;
    for (const [rawName, value] of reqHeaders.entries()) {
      const name = rawName.toLowerCase();
      if (config.requestHeaderSet.has(name)) {
        deferredRequestHeaderAttributes[httpRequestHeaderAttribute(name)] =
          typeof value === 'string' ? value : (value[0] ?? '');
      }
    }

    const finalize = (span?: Span, cause?: unknown) => {
      try {
        const status = c.res.status;

        if (span) {
          for (const [name, value] of c.res.headers.entries()) {
            const lower = name.toLowerCase();
            if (config.responseHeaderSet.has(lower)) {
              span.setAttribute(httpResponseHeaderAttribute(lower), value);
            }
          }
          span.setAttribute(HTTPAttributes.responseStatusCode, status);
          if (status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          if (cause) {
            try {
              // SAFETY: recordException accepts an Error or a description; a
              // route can throw anything, and the catch around this call covers
              // an implementation that rejects what it is given.
              span.recordException(cause as Error);
            } catch {
              // Ignore errors when recording exception
            }
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
        }
      } finally {
        activeReqs?.decrement(stableAttrs);
        span?.setAttribute(HTTPAttributes.route, routePath(c));
        span?.updateName(spanName(c));
        const durationSeconds = (now() - startTime) / 1000;
        requestDuration.record(durationSeconds, {
          ...stableAttrs,
          [HTTPAttributes.route]: routePath(c),
          [HTTPAttributes.responseStatusCode]: c.res.status,
        });
      }
    };

    if (!tracer) {
      try {
        await next();
        if (onBodyEnd(c, (cause) => finalize(undefined, cause))) return;
        finalize();
      } catch (error) {
        finalize(undefined, error);
        throw error;
      }
      return;
    }

    const parent = propagation.extract(otelContext.active(), c.req.header());
    return tracer.startActiveSpan(
      spanName(c),
      {
        kind: SpanKind.SERVER,
        startTime: config.getTime?.(),
        attributes: {
          ...stableAttrs,
          [URLAttributes.full]: c.req.url,
          [HTTPAttributes.route]: routePath(c),
        },
      },
      parent,
      async (span) => {
        let deferred = false;
        try {
          for (const [k, v] of Object.entries(
            deferredRequestHeaderAttributes,
          )) {
            span.setAttribute(k, v);
          }
          await next();
          // The response isn't sent when the handler returns (a streamed body
          // may run for minutes): end the span when the body has been sent.
          deferred = onBodyEnd(c, (cause) => {
            finalize(span, cause);
            span.end(config.getTime?.());
          });
          if (deferred) return;
          finalize(span, c.error);
        } catch (error) {
          finalize(span, error);
          throw error;
        } finally {
          if (!deferred) span.end(config.getTime?.());
        }
      },
    );
  });
}
