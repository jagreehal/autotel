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
  const p = (globalThis as unknown as { performance?: { now(): number } })
    .performance;
  return p?.now() ?? Date.now();
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
  return getTracer(config.tracerName ?? INSTRUMENTATION_SCOPE_NAME, config.serviceVersion);
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

    const stableAttrs: Record<string, string | number | undefined> = {
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
          typeof value === 'string' ? value : value[0] ?? '';
      }
    }

    const finalize = (span?: Span, error?: unknown) => {
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
          if (error) {
            try {
              span.recordException(error as Error);
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
        try {
          for (const [k, v] of Object.entries(deferredRequestHeaderAttributes)) {
            span.setAttribute(k, v);
          }
          await next();
          finalize(span, c.error);
        } catch (error) {
          finalize(span, error);
          throw error;
        } finally {
          span.end(config.getTime?.());
        }
      },
    );
  });
}
