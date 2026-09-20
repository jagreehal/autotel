/**
 * The SDK behind `init()`: builds and registers the tracer, meter and logger
 * providers from components autotel has already resolved.
 *
 * This replaces `@opentelemetry/sdk-node`'s `NodeSDK`. That class did the same
 * registration, but it statically imports every exporter the `OTEL_*_EXPORTER`
 * variables could name — OTLP over gRPC (`@grpc/grpc-js`, `protobufjs`),
 * Prometheus, the YAML file-config loader — so any bundle that contained
 * `init()` shipped ~1 MB of exporters it never used. autotel resolves its own
 * exporters up front, so all it ever needed from `NodeSDK` was `start()`.
 *
 * Kept from `NodeSDK`, because code and tests rely on them:
 *   - `OTEL_SDK_DISABLED=true` makes `start()` a no-op.
 *   - `OTEL_LOG_LEVEL` installs the console diag logger.
 *   - Resource: `envDetector`, `processDetector` and `hostDetector` are merged
 *     in, then `serviceName` is applied last so the resolved autotel value
 *     wins (`OTEL_NODE_RESOURCE_DETECTORS=none` turns detection off).
 *   - Context manager: `AsyncLocalStorageContextManager`.
 *   - Propagator: W3C trace context + baggage, or `OTEL_PROPAGATORS`.
 *   - Providers are only registered when they have something to do; an empty
 *     `spanProcessors` list still registers a tracer provider, so context keeps
 *     propagating even when nothing is exported.
 *
 * Not kept: building an exporter from `OTEL_TRACES_EXPORTER` /
 * `OTEL_LOGS_EXPORTER` / `OTEL_METRICS_EXPORTER`. autotel always passes its own
 * processors, so the traces and metrics variables never reached `NodeSDK`
 * anyway; `OTEL_LOGS_EXPORTER=none` still switches logs off, and `otlp` gets
 * the OTLP/HTTP log exporter. gRPC and Prometheus are no longer reachable from
 * the environment — pass an exporter through `init()` instead.
 */

import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  metrics,
  propagation,
  trace,
  type Sampler,
  type TextMapPropagator,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import {
  registerInstrumentations,
  type Instrumentation,
} from '@opentelemetry/instrumentation';
import {
  detectResources,
  envDetector,
  hostDetector,
  processDetector,
  resourceFromAttributes,
  type Resource,
  type ResourceDetector,
} from '@opentelemetry/resources';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { MeterProvider, type IMetricReader } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * What `init()` hands the SDK. Field names match `NodeSDKConfiguration` so a
 * `sdkFactory` written against the old shape still receives what it expects.
 */
export interface AutotelSdkOptions {
  resource?: Resource;
  serviceName?: string;
  sampler?: Sampler;
  instrumentations?: (Instrumentation | Instrumentation[])[];
  spanProcessors?: SpanProcessor[];
  metricReaders?: IMetricReader[];
  logRecordProcessors?: LogRecordProcessor[];
  /** `null` leaves whatever propagator is already registered alone. */
  textMapPropagator?: TextMapPropagator | null;
  /** Off by default only via `OTEL_NODE_RESOURCE_DETECTORS=none`. */
  autoDetectResources?: boolean;
  resourceDetectors?: ResourceDetector[];
}

/** The surface autotel needs from an SDK handle; `NodeSDK` satisfies it too. */
export interface AutotelSdkLike {
  start(): void;
  shutdown(): Promise<void>;
  getTracerProvider?(): BasicTracerProvider | undefined;
}

const DIAG_LEVELS: Record<string, DiagLogLevel> = {
  ALL: DiagLogLevel.ALL,
  VERBOSE: DiagLogLevel.VERBOSE,
  DEBUG: DiagLogLevel.DEBUG,
  INFO: DiagLogLevel.INFO,
  WARN: DiagLogLevel.WARN,
  ERROR: DiagLogLevel.ERROR,
  NONE: DiagLogLevel.NONE,
};

function envFlag(name: string): boolean {
  return (process.env[name] ?? '').trim().toLowerCase() === 'true';
}

function propagatorFromEnv(): TextMapPropagator | undefined {
  const raw = process.env.OTEL_PROPAGATORS?.trim();
  if (!raw) return undefined;
  const names = raw
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes('none'))
    return new CompositePropagator({ propagators: [] });
  const propagators: TextMapPropagator[] = [];
  for (const name of names) {
    if (name === 'tracecontext')
      propagators.push(new W3CTraceContextPropagator());
    else if (name === 'baggage') propagators.push(new W3CBaggagePropagator());
    else
      diag.warn(
        `[autotel] OTEL_PROPAGATORS names "${name}", which needs a propagator package autotel does not bundle; pass one via init({ propagator }).`,
      );
  }
  return propagators.length > 0
    ? new CompositePropagator({ propagators })
    : undefined;
}

function defaultPropagator(): TextMapPropagator {
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
}

export class AutotelSdk implements AutotelSdkLike {
  private readonly disabled: boolean;
  private tracerProvider: BasicTracerProvider | undefined;
  private meterProvider: MeterProvider | undefined;
  private loggerProvider: LoggerProvider | undefined;

  constructor(private readonly options: AutotelSdkOptions = {}) {
    this.disabled = envFlag('OTEL_SDK_DISABLED');

    const level = process.env.OTEL_LOG_LEVEL?.trim().toUpperCase();
    if (level && DIAG_LEVELS[level] !== undefined) {
      diag.setLogger(new DiagConsoleLogger(), { logLevel: DIAG_LEVELS[level] });
    }
  }

  start(): void {
    if (this.disabled) return;
    const o = this.options;

    const instrumentations = (o.instrumentations ?? []).flat();
    registerInstrumentations({ instrumentations });

    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );

    if (o.textMapPropagator !== null) {
      propagation.setGlobalPropagator(
        o.textMapPropagator ?? propagatorFromEnv() ?? defaultPropagator(),
      );
    }

    const resource = this.resolveResource();

    if (o.metricReaders && o.metricReaders.length > 0) {
      this.meterProvider = new MeterProvider({
        resource,
        readers: o.metricReaders,
      });
      metrics.setGlobalMeterProvider(this.meterProvider);
      // Instrumentations registered before the meter provider existed would
      // otherwise drop every metric (opentelemetry-js#3609).
      for (const instrumentation of instrumentations) {
        instrumentation.setMeterProvider(this.meterProvider);
      }
    }

    // Always registered, even with no processors: not exporting and not
    // tracing are different things, and `traceparent` only propagates from a
    // recording span.
    // Keys are only set when defined: the provider deep-merges this over its
    // env-derived defaults, and an explicit `undefined` would erase them.
    this.tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: o.spanProcessors ?? [],
      ...(o.sampler && { sampler: o.sampler }),
    });
    trace.setGlobalTracerProvider(this.tracerProvider);

    const logProcessors = this.resolveLogProcessors();
    if (logProcessors) {
      this.loggerProvider = new LoggerProvider({
        resource,
        processors: logProcessors,
      });
      logs.setGlobalLoggerProvider(this.loggerProvider);
    }
  }

  getTracerProvider(): BasicTracerProvider | undefined {
    return this.tracerProvider;
  }

  async shutdown(): Promise<void> {
    // shutdown() alone drops exports still waiting on async resource
    // detection (SimpleSpanProcessor only awaits them in forceFlush()).
    // A failed export must not skip the shutdown that releases the exporters.
    await Promise.allSettled([
      this.tracerProvider?.forceFlush(),
      this.loggerProvider?.forceFlush(),
      this.meterProvider?.forceFlush(),
    ]);
    await Promise.all([
      this.tracerProvider?.shutdown(),
      this.loggerProvider?.shutdown(),
      this.meterProvider?.shutdown(),
    ]);
  }

  private resolveResource(): Resource {
    const o = this.options;
    let resource = o.resource ?? resourceFromAttributes({});

    const detectorsEnv = process.env.OTEL_NODE_RESOURCE_DETECTORS?.trim();
    const detect =
      o.autoDetectResources ?? detectorsEnv?.toLowerCase() !== 'none';
    if (detect) {
      const detectors = o.resourceDetectors ?? [
        envDetector,
        processDetector,
        hostDetector,
      ];
      resource = resource.merge(detectResources({ detectors }));
    }

    // Applied last so autotel's resolved name beats anything a detector read
    // from the environment: explicit > YAML > env, as documented.
    if (o.serviceName !== undefined) {
      resource = resource.merge(
        resourceFromAttributes({ [ATTR_SERVICE_NAME]: o.serviceName }),
      );
    }
    return resource;
  }

  /**
   * `init()` passes a list when it configured logs itself and `undefined` to
   * defer to `OTEL_LOGS_EXPORTER`. Only `otlp` (over HTTP) and `none`/unset
   * are honoured there; any other value is named in a warning.
   */
  private resolveLogProcessors(): LogRecordProcessor[] | undefined {
    const configured = this.options.logRecordProcessors;
    if (configured) return configured;

    const fromEnv = process.env.OTEL_LOGS_EXPORTER?.trim().toLowerCase();
    if (!fromEnv || fromEnv === 'none') return undefined;
    if (fromEnv === 'otlp') {
      return [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })];
    }
    diag.warn(
      `[autotel] OTEL_LOGS_EXPORTER=${fromEnv} is not supported without sdk-node; pass a log exporter via init() instead.`,
    );
    return undefined;
  }
}
