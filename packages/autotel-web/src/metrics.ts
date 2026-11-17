/**
 * Browser metrics: `autotel-web/metrics`.
 *
 * Its own entry so neither lean nor full mode pays for the metrics SDK: a page
 * that counts nothing ships none of it.
 *
 * ```ts
 * import { initFull } from 'autotel-web/full';
 * import { initMetrics, createCounter } from 'autotel-web/metrics';
 *
 * initFull({ service: 'web', endpoint: 'https://otel.example.com' });
 * initMetrics(); // same service, endpoint and release
 *
 * const checkouts = createCounter('app.checkout.completed');
 * checkouts.add(1, { plan: 'pro' });
 * ```
 *
 * Two decisions differ from spans and logs, on purpose:
 *
 * - **Delta temporality.** Every tab reports under the same resource, so
 *   cumulative series from two tabs are indistinguishable to a backend: each
 *   export looks like a counter reset. Deltas add up across tabs. A Prometheus
 *   backend needs the collector's `deltatocumulative` processor.
 * - **No session sampling, and no `session.id`.** A metric is already an
 *   aggregate; dropping a share of sessions makes every count a guess, and a
 *   per-session attribute turns one series into one per visit.
 */

import {
  createNoopMeter,
  metrics,
  type Attributes,
  type Context,
  type Counter,
  type Histogram,
  type Meter,
  type MetricOptions,
  type UpDownCounter,
} from '@opentelemetry/api';
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  browserResourceAttributes,
  pageIdentity,
  releaseResourceAttributes,
  type ReleaseConfig,
} from './browser-context';
import { otlpEndpointFor } from './otlp-endpoint';

/** Instrumentation scope of every instrument created here. */
const SCOPE = 'autotel-web';

/**
 * Long enough that an open tab is not a request every few seconds, short
 * enough that most visits export at least once before the hide flush.
 */
const DEFAULT_EXPORT_INTERVAL_MS = 15_000;

export interface AutotelWebMetricsConfig extends ReleaseConfig {
  /** `service.name`. Defaults to the service `init()` / `initFull()` was given. */
  service?: string;
  /**
   * OTLP endpoint; `/v1/metrics` is appended to a bare origin, or swapped in
   * for `/v1/traces`. Defaults to the endpoint `init()` / `initFull()` was
   * given. With neither, metrics are recorded and not exported.
   */
  endpoint?: string;
  /** How often to export. @default 15000 */
  exportIntervalMs?: number;
  /**
   * More readers alongside the OTLP export, e.g. a
   * `PeriodicExportingMetricReader` around a `ConsoleMetricExporter` while
   * developing.
   */
  metricReaders?: MetricReader[];
  /** Log setup to the console. @default false */
  debug?: boolean;
}

let provider: MeterProvider | undefined;
/** Bumped by every init, so instruments built for an old provider rebuild. */
let generation = 0;
let detachHideFlush: (() => void) | undefined;

/**
 * Start exporting metrics. Call once, client-side, after `init()` or
 * `initFull()` if you want their service, endpoint and release.
 */
export function initMetrics(config: AutotelWebMetricsConfig = {}): void {
  if (globalThis.window === undefined) return;
  if (provider) {
    if (config.debug) {
      console.warn('[autotel-web/metrics] Already initialized. Skipping.');
    }
    return;
  }

  const target = pageIdentity();
  const endpoint = config.endpoint ?? target?.endpoint;
  const release = releaseResourceAttributes(config);
  const resource = resourceFromAttributes({
    ...target?.resource,
    ...release,
    ...browserResourceAttributes(),
    'service.name': config.service ?? target?.service ?? 'browser',
  });

  const readers: MetricReader[] = [];
  if (endpoint !== undefined) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: otlpEndpointFor(endpoint, 'metrics'),
          temporalityPreference: AggregationTemporalityPreference.DELTA,
        }),
        exportIntervalMillis:
          config.exportIntervalMs ?? DEFAULT_EXPORT_INTERVAL_MS,
      }),
    );
  }
  readers.push(...(config.metricReaders ?? []));

  provider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(provider);
  generation += 1;

  // The interval never fires for the last stretch of a visit; hiding is the
  // last moment a page is reliably still able to send.
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void flushMetrics();
  };
  document.addEventListener('visibilitychange', onHide);
  detachHideFlush = () =>
    document.removeEventListener('visibilitychange', onHide);

  if (config.debug) {
    console.log('[autotel-web/metrics] Initialized', {
      endpoint: endpoint === undefined ? 'none: not exported' : endpoint,
      readers: readers.length,
    });
  }
}

/** Export everything recorded so far, now. */
export async function flushMetrics(): Promise<void> {
  await provider?.forceFlush();
}

/**
 * Export what is pending and stop. Instruments keep working as no-ops, and
 * `initMetrics()` may be called again.
 */
export async function shutdownMetrics(): Promise<void> {
  const current = provider;
  if (!current) return;
  detachHideFlush?.();
  detachHideFlush = undefined;
  provider = undefined;
  // The API will not replace a registered provider; release it for the next init.
  metrics.disable();
  await current.shutdown();
}

/** The live provider's meter, or a no-op one before `initMetrics()`. */
function currentMeter(): Meter {
  return provider?.getMeter(SCOPE) ?? createNoopMeter();
}

/**
 * Resolves the real instrument on first use after `initMetrics()`, so an
 * instrument declared at module scope — before the app's entry point has
 * called `initMetrics()` — still records once it has. Measurements taken
 * before then are dropped.
 */
function lazily<T>(create: (meter: Meter) => T): () => T {
  let built: T | undefined;
  let builtFor = -1;
  return () => {
    if (builtFor !== generation || built === undefined) {
      built = create(currentMeter());
      builtFor = generation;
    }
    return built;
  };
}

/** A monotonic sum, e.g. requests made. */
export function createCounter(name: string, options?: MetricOptions): Counter {
  const instrument = lazily((meter) => meter.createCounter(name, options));
  return {
    add: (value: number, attributes?: Attributes, context?: Context) =>
      instrument().add(value, attributes, context),
  };
}

/** A sum that goes both ways, e.g. items in a cart. */
export function createUpDownCounter(
  name: string,
  options?: MetricOptions,
): UpDownCounter {
  const instrument = lazily((meter) =>
    meter.createUpDownCounter(name, options),
  );
  return {
    add: (value: number, attributes?: Attributes, context?: Context) =>
      instrument().add(value, attributes, context),
  };
}

/** A distribution, e.g. how long a render took. */
export function createHistogram(
  name: string,
  options?: MetricOptions,
): Histogram {
  const instrument = lazily((meter) => meter.createHistogram(name, options));
  return {
    record: (value: number, attributes?: Attributes, context?: Context) =>
      instrument().record(value, attributes, context),
  };
}

/** @internal Reset for testing */
export async function resetMetricsForTesting(): Promise<void> {
  await shutdownMetrics();
  generation = 0;
}
