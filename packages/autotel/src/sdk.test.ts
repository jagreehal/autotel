import {
  context,
  metrics,
  propagation,
  trace,
  type Context,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import {
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';
import {
  AlwaysOffSampler,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutotelSdk } from './sdk';

let sdk: AutotelSdk | undefined;

/** Keeps what it saw across shutdown, unlike the in-memory exporters. */
function recorder<T>() {
  const seen: T[] = [];
  return {
    seen,
    export: (items: T[], cb: (r: { code: number }) => void) => {
      seen.push(...items);
      cb({ code: 0 });
    },
    shutdown: async () => {},
    forceFlush: async () => {},
  };
}
const env = { ...process.env };

function reset() {
  trace.disable();
  metrics.disable();
  propagation.disable();
  context.disable();
  logs.disable();
}

beforeEach(() => {
  process.env = { ...env };
  reset();
});

afterEach(async () => {
  await sdk?.shutdown();
  sdk = undefined;
  reset();
  process.env = env;
});

// Detected resources (host id, process) resolve asynchronously and the simple
// processor holds exports until they do — flush() in production, this here.
const flushed = async (exporter: InMemorySpanExporter) => {
  await sdk!.getTracerProvider()!.forceFlush();
  return exporter.getFinishedSpans();
};

function tracerSdk(extra: ConstructorParameters<typeof AutotelSdk>[0] = {}) {
  const exporter = new InMemorySpanExporter();
  sdk = new AutotelSdk({
    serviceName: 'sdk-test',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    ...extra,
  });
  sdk.start();
  return exporter;
}

describe('AutotelSdk', () => {
  it('registers a tracer provider that exports spans with the service name', async () => {
    const exporter = tracerSdk();
    trace.getTracer('t').startSpan('op').end();
    const [span] = await flushed(exporter);
    expect(span?.name).toBe('op');
    expect(span?.resource.attributes[ATTR_SERVICE_NAME]).toBe('sdk-test');
  });

  it('applies serviceName after detected resources, so the explicit value wins', async () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      'service.name=from-env,deployment.environment=qa';
    const exporter = tracerSdk();
    trace.getTracer('t').startSpan('op').end();
    const [span] = await flushed(exporter);
    const attrs = span!.resource.attributes;
    expect(attrs[ATTR_SERVICE_NAME]).toBe('sdk-test');
    expect(attrs['deployment.environment']).toBe('qa');
  });

  it('merges a caller-supplied resource', async () => {
    const exporter = tracerSdk({
      resource: resourceFromAttributes({ 'app.tier': 'gold' }),
    });
    trace.getTracer('t').startSpan('op').end();
    const [span] = await flushed(exporter);
    expect(span!.resource.attributes['app.tier']).toBe('gold');
  });

  it('can turn detection off', async () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'deployment.environment=qa';
    const exporter = tracerSdk({ autoDetectResources: false });
    trace.getTracer('t').startSpan('op').end();
    const [span] = await flushed(exporter);
    expect(span!.resource.attributes['deployment.environment']).toBeUndefined();
  });

  it('honours the sampler', async () => {
    const exporter = tracerSdk({ sampler: new AlwaysOffSampler() });
    trace.getTracer('t').startSpan('op').end();
    expect(await flushed(exporter)).toHaveLength(0);
  });

  it('keeps a tracer provider registered with no processors, so context still propagates', () => {
    sdk = new AutotelSdk({ serviceName: 'sdk-test', spanProcessors: [] });
    sdk.start();
    const span = trace.getTracer('t').startSpan('op');
    expect(span.spanContext().traceId).not.toBe(
      '00000000000000000000000000000000',
    );
    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(context.active(), span), carrier);
    expect(carrier.traceparent).toContain(span.spanContext().traceId);
    span.end();
  });

  it('installs an async context manager: the active span survives an await', async () => {
    tracerSdk();
    const span = trace.getTracer('t').startSpan('parent');
    const active = await context.with(
      trace.setSpan(context.active(), span),
      async () => {
        await new Promise((r) => setTimeout(r, 1));
        return trace.getSpan(context.active());
      },
    );
    expect(active).toBe(span);
    span.end();
  });

  it('propagates baggage by default and honours OTEL_PROPAGATORS', () => {
    tracerSdk();
    const carrier: Record<string, string> = {};
    const ctx: Context = propagation.setBaggage(
      context.active(),
      propagation.createBaggage({ tenant: { value: 'acme' } }),
    );
    propagation.inject(ctx, carrier);
    expect(carrier.baggage).toContain('tenant=acme');

    reset();
    process.env.OTEL_PROPAGATORS = 'tracecontext';
    tracerSdk();
    const only: Record<string, string> = {};
    propagation.inject(ctx, only);
    expect(only.baggage).toBeUndefined();
  });

  it('leaves the propagator alone when textMapPropagator is null', () => {
    tracerSdk({ textMapPropagator: null });
    const carrier: Record<string, string> = {};
    const span = trace.getTracer('t').startSpan('op');
    propagation.inject(trace.setSpan(context.active(), span), carrier);
    expect(carrier.traceparent).toBeUndefined();
    span.end();
  });

  it('registers a meter provider only when there are readers', async () => {
    tracerSdk();
    expect(metrics.getMeterProvider().constructor.name).not.toBe(
      'MeterProvider',
    );
    await sdk!.shutdown();
    reset();

    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    tracerSdk({
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    metrics.getMeter('m').createCounter('hits').add(1);
    await sdk!.shutdown();
    const points = exporter
      .getMetrics()
      .flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics));
    expect(points.map((p) => p.descriptor.name)).toContain('hits');
    sdk = undefined;
  });

  it('registers a logger provider for a processor list and none for OTEL_LOGS_EXPORTER=none', async () => {
    const logExporter = recorder<{ body?: unknown }>();
    tracerSdk({
      logRecordProcessors: [
        new SimpleLogRecordProcessor({ exporter: logExporter as never }),
      ],
    });
    logs.getLogger('l').emit({ body: 'hello' });
    await sdk!.shutdown();
    expect(logExporter.seen.map((r) => r.body)).toEqual(['hello']);
    sdk = undefined;
    reset();

    process.env.OTEL_LOGS_EXPORTER = 'none';
    tracerSdk({ logRecordProcessors: undefined });
    expect(logs.getLoggerProvider().constructor.name).not.toBe(
      'LoggerProvider',
    );
  });

  it('is a no-op when OTEL_SDK_DISABLED=true', () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const exporter = tracerSdk();
    expect(sdk!.getTracerProvider()).toBeUndefined();
    const span = trace.getTracer('t').startSpan('op');
    expect(span.isRecording()).toBe(false);
    span.end();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('exposes the tracer provider so flush() can reach forceFlush', async () => {
    tracerSdk();
    const provider = sdk!.getTracerProvider();
    expect(typeof provider?.forceFlush).toBe('function');
    await expect(provider!.forceFlush()).resolves.toBeUndefined();
  });

  it('shutdown still shuts providers down when a flush rejects', async () => {
    const shutdown = vi.fn(async () => {});
    sdk = new AutotelSdk({
      serviceName: 'sdk-test',
      spanProcessors: [
        {
          onStart() {},
          onEnd() {},
          forceFlush: async () => {
            throw new Error('export failed');
          },
          shutdown,
        },
      ],
    });
    sdk.start();
    await expect(sdk.shutdown()).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
    sdk = undefined;
  });

  it('shutdown flushes every provider and resolves', async () => {
    const exporter = recorder<{ name: string }>();
    sdk = new AutotelSdk({
      serviceName: 'sdk-test',
      spanProcessors: [new SimpleSpanProcessor(exporter as never)],
    });
    sdk.start();
    trace.getTracer('t').startSpan('op').end();
    // Same order autotel's shutdown() uses: flush, then shut down.
    await sdk.getTracerProvider()!.forceFlush();
    await expect(sdk.shutdown()).resolves.toBeUndefined();
    expect(exporter.seen.map((s) => s.name)).toEqual(['op']);
    sdk = undefined;
  });
});
