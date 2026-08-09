/**
 * Simplified initialization for autotel
 *
 * Single init() function with sensible defaults.
 * Replaces initInstrumentation() and separate events config.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  type SpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  SamplingDecision,
  type Sampler as OtelSampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { Sampler } from './sampling';
import {
  samplingPresets,
  resolveSamplingPreset,
  AUTOTEL_SAMPLING_RATE,
} from './sampling';
import type { Logger } from './logger';
import { silentLogger, wrapLogger } from './init-logger';
import type { Attributes, Context, SpanKind, Link } from '@opentelemetry/api';
import type { ValidationConfig } from './validation';
import {
  PeriodicExportingMetricReader,
  type MetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BatchLogRecordProcessor,
  type LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  buildPostHogLogProcessors,
  RedactingLogRecordProcessor,
} from './posthog-logs';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import { BaggageSpanProcessor } from './baggage-span-processor';
import { FilteringSpanProcessor } from './filtering-span-processor';
import {
  PolicyLogRecordProcessor,
  policySpanFilter,
  setPolicies,
  watchPolicyFile,
} from './policy';
import { SpanNameNormalizingProcessor } from './span-name-normalizer';
import {
  AttributeRedactingProcessor,
  normalizeAttributeRedactorConfig,
} from './attribute-redacting-processor';
import { createStringRedactor, type StringRedactor } from './redact-values';
import { PrettyConsoleExporter } from './pretty-console-exporter';
import { resolveConfigFromEnv } from './env-config';
import { loadYamlConfig } from './yaml-config';
import { safeRequire } from './node-require';
import {
  CanonicalLogLineProcessor,
  type CanonicalLogLineOptions,
} from './processors/canonical-log-line-processor';
import type { EventsConfig } from './events-config';
import { resolveDevtoolsConfig } from './devtools';
import {
  installExitFlush,
  installProcessHandlers,
  uninstallProcessHandlers,
} from './process-handlers';
import { flush, shutdown } from './shutdown';
import type { AutotelConfig } from './autotel-config';
import {
  detectEnvironmentAttributes,
  detectHostname,
  detectVersion,
  destinationSupportsSignal,
  readMillisEnv,
  resolveAttributeRedactor,
  resolveDebugFlag,
  resolveLogsFlag,
  resolveMetricsFlag,
  resolveOtlpDestinations,
} from './config-resolution';
import {
  getAutoInstrumentations,
  getInstrumentationNames,
  isESMMode,
  _resetAutoInstrumentationsLoader,
  _setAutoInstrumentationsLoader,
  type AutoInstrumentationsLoader,
} from './auto-instrumentations';
import {
  createLogExporter,
  createMetricExporter,
  createTraceExporter,
  formatEndpointUrl,
  resolveProtocol,
  type AutotelProtocol,
  type OtlpDestinationConfig,
  type OtlpSignal,
} from './otlp-exporters';

// Re-exported: these were part of init.ts's surface before the exporter code
// moved to its own module, and `autotel` is imported by path in the wild.
export type { AutotelConfig };
// Re-exported: part of init.ts's surface before these moved to their own module.
export {
  resolveAttributeRedactor,
  resolveDebugFlag,
  resolveLogsFlag,
  resolveMetricsFlag,
};
export {
  _resetAutoInstrumentationsLoader,
  _setAutoInstrumentationsLoader,
  type AutoInstrumentationsLoader,
};
export {
  createTraceExporter,
  formatEndpointUrl,
  resolveProtocol,
  type AutotelProtocol,
  type OtlpDestinationConfig,
  type OtlpSignal,
};

/**
 * Adapts an Autotel Sampler to the OTel SDK Sampler interface.
 */
function toOtelSampler(sampler: Sampler): OtelSampler {
  return {
    shouldSample(
      _context: Context,
      _traceId: string,
      spanName: string,
      _spanKind: SpanKind,
      _attributes: Attributes,
      links: Link[],
    ): SamplingResult {
      const samplingContext = {
        operationName: spanName,
        args: [],
        links,
      };
      const shouldTrace = sampler.shouldSample(samplingContext);
      const rate = sampler.sampleRate?.(samplingContext);
      return {
        decision: shouldTrace
          ? SamplingDecision.RECORD_AND_SAMPLED
          : SamplingDecision.NOT_RECORD,
        // Let a query reweight counts back to the true population.
        ...(shouldTrace && rate !== undefined && rate > 1
          ? { attributes: { [AUTOTEL_SAMPLING_RATE]: rate } }
          : {}),
      };
    },
    toString(): string {
      return `AutotelSamplerAdapter`;
    },
  };
}

// Internal state
let initialized = false;
let locked = false;
let config: AutotelConfig | null = null;
let sdk: NodeSDK | null = null;
let warnedOnce = false;
let logger: Logger = silentLogger; // Silent by default - no spam
let validationConfig: Partial<ValidationConfig> | null = null;
let eventsConfig: EventsConfig | null = null;
let _stringRedactor: StringRedactor | null = null;

/** Subscribers may opt into value redaction by exposing this setter. */
interface StringRedactorAware {
  setStringRedactor: (redact: StringRedactor) => void;
}

function acceptsStringRedactor(
  subscriber: unknown,
): subscriber is StringRedactorAware {
  return (
    typeof subscriber === 'object' &&
    subscriber !== null &&
    'setStringRedactor' in subscriber &&
    typeof (subscriber as StringRedactorAware).setStringRedactor === 'function'
  );
}
let _optionalRequire: typeof safeRequire = safeRequire;
let _devtoolsClose: (() => Promise<void> | void) | null = null;

/**
 * Lock the logger to prevent further `init()` calls.
 * Use this when framework plugins set up instrumentation and you want
 * to prevent accidental re-initialization from user code.
 */
export function lockLogger(): void {
  locked = true;
}

/**
 * Check if the logger has been locked.
 */
export function isLoggerLocked(): boolean {
  return locked;
}

/**
 * Initialize autotel - Write Once, Observe Everywhere
 *
 * Follows OpenTelemetry standards: opinionated defaults with full flexibility
 * Idempotent: multiple calls are safe, last one wins
 *
 * @example Minimal setup (OTLP default)
 * ```typescript
 * init({ service: 'my-app' })
 * ```
 *
 * @example With events (observe in PostHog, Mixpanel, etc.)
 * ```typescript
 * import { PostHogSubscriber } from 'autotel-subscribers/posthog';
 *
 * init({
 *   service: 'my-app',
 *   subscribers: [new PostHogSubscriber({ apiKey: '...' })]
 * })
 * ```
 *
 * @example Observe in Jaeger
 * ```typescript
 * import { JaegerExporter } from '@opentelemetry/exporter-jaeger'
 *
 * init({
 *   service: 'my-app',
 *   spanExporter: new JaegerExporter({ endpoint: 'http://localhost:14268/api/traces' })
 * })
 * ```
 *
 * @example Observe in Zipkin
 * ```typescript
 * import { ZipkinExporter } from '@opentelemetry/exporter-zipkin'
 *
 * init({
 *   service: 'my-app',
 *   spanExporter: new ZipkinExporter({ url: 'http://localhost:9411/api/v2/spans' })
 * })
 * ```
 *
 * @example Observe in Datadog
 * ```typescript
 * import { DatadogSpanProcessor } from '@opentelemetry/exporter-datadog'
 *
 * init({
 *   service: 'my-app',
 *   spanProcessor: new DatadogSpanProcessor({ ... })
 * })
 * ```
 *
 * @example Console output (dev)
 * ```typescript
 * import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
 *
 * init({
 *   service: 'my-app',
 *   spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter())
 * })
 * ```
 */

export function init(cfg: AutotelConfig): void {
  if (locked) {
    return;
  }

  // Resolve configs in priority order: explicit > yaml > env > defaults
  const envConfig = resolveConfigFromEnv();
  const yamlConfig = loadYamlConfig() ?? {};

  // Merge configs: explicit config > yaml file > env vars > defaults
  const mergedConfig: AutotelConfig = {
    ...envConfig, // Environment variables (lowest priority)
    ...yamlConfig, // YAML file (middle priority)
    ...cfg, // Explicit config (highest priority)
    // Deep merge for resourceAttributes
    resourceAttributes: {
      ...envConfig.resourceAttributes,
      ...yamlConfig.resourceAttributes,
      ...detectEnvironmentAttributes(),
      ...cfg.resourceAttributes,
    },
    // Handle headers merge (can be string or object)
    headers: cfg.headers ?? yamlConfig.headers ?? envConfig.headers,
  } as AutotelConfig;

  const resolvedRedactor = resolveAttributeRedactor(
    mergedConfig.attributeRedactor,
    mergedConfig.environment || process.env.NODE_ENV || 'development',
  );
  if (resolvedRedactor === undefined) {
    mergedConfig.attributeRedactor = undefined;
  } else {
    const normalizedRedactor =
      normalizeAttributeRedactorConfig(resolvedRedactor);
    if (!normalizedRedactor) {
      throw new Error('Invalid attributeRedactor config');
    }
    mergedConfig.attributeRedactor = normalizedRedactor;
  }

  const devtoolsConfig = resolveDevtoolsConfig(mergedConfig.devtools);
  if (devtoolsConfig.enabled && mergedConfig.logs === undefined) {
    mergedConfig.logs = true;
  }

  const silent = mergedConfig.silent ?? false;
  const minLevel = mergedConfig.minLevel ?? 'info';
  const baseLogger = mergedConfig.logger || silentLogger;
  logger = wrapLogger(baseLogger, silent, minLevel);

  // Warn if re-initializing (same behavior in all environments)
  if (initialized) {
    logger.warn(
      {},
      '[autotel] init() called again - last config wins. This may cause unexpected behavior.',
    );
  }

  config = mergedConfig;
  validationConfig = mergedConfig.validation || null;
  eventsConfig = mergedConfig.events || null;

  // Initialize OpenTelemetry
  // Only use endpoint if explicitly configured (no default fallback)
  let endpoint = mergedConfig.endpoint ?? devtoolsConfig.endpoint;
  const version = mergedConfig.version || detectVersion();
  const environment =
    mergedConfig.environment || process.env.NODE_ENV || 'development';
  const metricsEnabled = resolveMetricsFlag(mergedConfig.metrics);
  const logsEnabled = resolveLogsFlag(mergedConfig.logs);

  if (devtoolsConfig.enabled && devtoolsConfig.embedded) {
    const devtoolsModule = _optionalRequire<{
      createDevtools?: (options?: {
        port?: number;
        host?: string;
        verbose?: boolean;
      }) => { port: number; close: () => Promise<void> | void };
    }>('autotel-devtools');

    if (devtoolsModule?.createDevtools) {
      const devtoolsInstance = devtoolsModule.createDevtools({
        port: devtoolsConfig.port,
        host: devtoolsConfig.host,
        verbose: devtoolsConfig.verbose,
      });
      _devtoolsClose = devtoolsInstance.close;
      endpoint = `http://${devtoolsConfig.host}:${devtoolsInstance.port}`;
      logger.info(
        {},
        `[autotel] autotel-devtools embedded server started at ${endpoint}`,
      );
    } else {
      logger.warn(
        {},
        '[autotel] devtools.embedded requested but autotel-devtools is not installed. Falling back to endpoint-only mode.',
      );
    }
  }

  // Detect hostname for proper Datadog correlation and Service Catalog discovery
  const hostname = detectHostname();

  let resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: mergedConfig.service,
    [ATTR_SERVICE_VERSION]: version,
    // Support both old and new OpenTelemetry semantic conventions for environment
    'deployment.environment': environment, // Deprecated but widely supported
    'deployment.environment.name': environment, // OTel v1.27.0+ standard
  });

  // Add hostname attributes for Datadog Service Catalog and infrastructure correlation
  if (hostname) {
    resource = resource.merge(
      resourceFromAttributes({
        'host.name': hostname, // OpenTelemetry standard
        'datadog.host.name': hostname, // Datadog-specific, highest priority for Datadog
      }),
    );
  }

  if (mergedConfig.resource) {
    resource = resource.merge(mergedConfig.resource);
  }

  if (mergedConfig.resourceAttributes) {
    resource = resource.merge(
      resourceFromAttributes(mergedConfig.resourceAttributes),
    );
  }

  const otlpDestinations = resolveOtlpDestinations(mergedConfig, endpoint);

  // Backward-compatible singular aliases. Plural forms take precedence when both are provided.
  const configuredSpanProcessors =
    mergedConfig.spanProcessors && mergedConfig.spanProcessors.length > 0
      ? mergedConfig.spanProcessors
      : mergedConfig.spanProcessor
        ? [mergedConfig.spanProcessor]
        : undefined;
  const configuredSpanExporters =
    mergedConfig.spanExporters && mergedConfig.spanExporters.length > 0
      ? mergedConfig.spanExporters
      : mergedConfig.spanExporter
        ? [mergedConfig.spanExporter]
        : undefined;
  const configuredMetricReaders =
    mergedConfig.metricReaders && mergedConfig.metricReaders.length > 0
      ? mergedConfig.metricReaders
      : mergedConfig.metricReader
        ? [mergedConfig.metricReader]
        : undefined;
  const configuredLogRecordProcessors =
    mergedConfig.logRecordProcessors &&
    mergedConfig.logRecordProcessors.length > 0
      ? mergedConfig.logRecordProcessors
      : mergedConfig.logRecordProcessor
        ? [mergedConfig.logRecordProcessor]
        : undefined;

  // Build array of span processors (supports multiple)
  let spanProcessors: SpanProcessor[] = [];

  if (configuredSpanProcessors && configuredSpanProcessors.length > 0) {
    // User provided custom processors (full control)
    spanProcessors.push(...configuredSpanProcessors);
  } else if (configuredSpanExporters && configuredSpanExporters.length > 0) {
    // User provided custom exporters (wrap each with tail sampling)
    for (const exporter of configuredSpanExporters) {
      spanProcessors.push(
        new TailSamplingSpanProcessor(new BatchSpanProcessor(exporter)),
      );
    }
  } else {
    for (const destination of otlpDestinations) {
      if (!destinationSupportsSignal(destination, 'traces')) continue;

      const traceExporter = createTraceExporter(destination.protocol, {
        url: formatEndpointUrl(
          destination.endpoint,
          'traces',
          destination.protocol,
        ),
        headers: destination.headers,
      });

      spanProcessors.push(
        new TailSamplingSpanProcessor(new BatchSpanProcessor(traceExporter)),
      );
    }
  }
  // If no endpoint and no custom processors/exporters, array remains empty
  // SDK will still work but won't export traces

  // Add baggage span processor if enabled
  if (mergedConfig.baggage) {
    const prefix =
      typeof mergedConfig.baggage === 'string'
        ? mergedConfig.baggage
          ? `${mergedConfig.baggage}.`
          : ''
        : 'baggage.';
    spanProcessors.push(new BaggageSpanProcessor({ prefix }));
  }

  // Apply debug mode configuration
  const debugMode = resolveDebugFlag(mergedConfig.debug);

  if (debugMode === 'pretty') {
    // Pretty debug: colorized, hierarchical output
    spanProcessors.push(new SimpleSpanProcessor(new PrettyConsoleExporter()));
  } else if (debugMode === true) {
    // Raw debug: JSON output
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // Add canonical log line processor BEFORE wrapping processors
  // This ensures it gets wrapped with the same filter/normalizer/redactor as other processors,
  // so canonical logs respect spanFilter (filtered spans aren't logged), spanNameNormalizer
  // (normalized names are used), and attributeRedactor (sensitive data is redacted).
  if (mergedConfig.canonicalLogLines?.enabled) {
    const canonicalOptions: CanonicalLogLineOptions = {
      logger: mergedConfig.canonicalLogLines.logger || mergedConfig.logger,
      rootSpansOnly: mergedConfig.canonicalLogLines.rootSpansOnly,
      minLevel: mergedConfig.canonicalLogLines.minLevel,
      messageFormat: mergedConfig.canonicalLogLines.messageFormat,
      includeResourceAttributes:
        mergedConfig.canonicalLogLines.includeResourceAttributes,
      shouldEmit: mergedConfig.canonicalLogLines.shouldEmit,
      keep: mergedConfig.canonicalLogLines.keep,
      drain: mergedConfig.canonicalLogLines.drain,
      onDrainError: mergedConfig.canonicalLogLines.onDrainError,
      pretty: mergedConfig.canonicalLogLines.pretty,
    };
    spanProcessors.push(new CanonicalLogLineProcessor(canonicalOptions));
  }

  // Wrap processors in order: redactor (innermost) → normalizer → filter (outermost)
  // This ensures onEnd() execution order is: filter → normalizer → redactor
  // So filtering sees original attributes, and redaction happens last before export.

  // Step 1: Wrap with AttributeRedactingProcessor (innermost - executes last in onEnd)
  if (mergedConfig.attributeRedactor && spanProcessors.length > 0) {
    const redactor = mergedConfig.attributeRedactor;
    spanProcessors = spanProcessors.map(
      (processor) =>
        new AttributeRedactingProcessor(processor, {
          redactor,
        }),
    );
  }

  // Store string redactor for use by PostHog log/subscriber paths
  if (mergedConfig.attributeRedactor) {
    _stringRedactor = createStringRedactor(mergedConfig.attributeRedactor);
  }

  // Wire string redactor to subscribers that support it (e.g., PostHogSubscriber)
  if (_stringRedactor && mergedConfig.subscribers) {
    for (const subscriber of mergedConfig.subscribers) {
      if (acceptsStringRedactor(subscriber)) {
        subscriber.setStringRedactor(_stringRedactor);
      }
    }
  }

  // Step 2: Wrap with SpanNameNormalizingProcessor (middle)
  // Normalizer runs in onStart(), so span names are normalized before any onEnd processing
  if (mergedConfig.spanNameNormalizer && spanProcessors.length > 0) {
    spanProcessors = spanProcessors.map(
      (processor) =>
        new SpanNameNormalizingProcessor(processor, {
          normalizer: mergedConfig.spanNameNormalizer!,
        }),
    );
  }

  // Telemetry Policies (OTEP 4738) — load the policy set, then compose the
  // policy span filter with any user-supplied one. Both must pass to keep.
  if (mergedConfig.policies) {
    if (typeof mergedConfig.policies === 'string') {
      watchPolicyFile(mergedConfig.policies);
    } else {
      setPolicies(mergedConfig.policies);
    }
    const userSpanFilter = mergedConfig.spanFilter;
    mergedConfig.spanFilter = userSpanFilter
      ? (span) => userSpanFilter(span) && policySpanFilter(span)
      : policySpanFilter;
  }

  // Step 3: Wrap with FilteringSpanProcessor (outermost - executes first in onEnd)
  // Filter sees original (unredacted) attributes, so it can match on sensitive values
  if (mergedConfig.spanFilter && spanProcessors.length > 0) {
    spanProcessors = spanProcessors.map(
      (processor) =>
        new FilteringSpanProcessor(processor, {
          filter: mergedConfig.spanFilter!,
        }),
    );
  }

  // Enrichers go on last so they sit OUTSIDE the wrappers above, and first in
  // the array so they run before anything exports.
  //
  // Outside matters more than it looks. `AttributeRedactingProcessor` hands its
  // wrapped processor a proxy whose `attributes` is a private redacted copy, so
  // an enricher wrapped by it would decorate that copy while every exporter
  // received its own copy taken from the original span: the enrichment would
  // reach no destination at all, and only when redaction happened to be
  // configured. Left outside, an enricher decorates the real span, and the
  // redactor downstream then sees the attributes it added rather than missing
  // an enricher that copied a sensitive value into a new key.
  //
  // Unlike `spanProcessors`, these add to the pipeline instead of replacing it.
  if (mergedConfig.spanEnrichers && mergedConfig.spanEnrichers.length > 0) {
    spanProcessors.unshift(...mergedConfig.spanEnrichers);
  }

  // Build array of metric readers (supports multiple)
  const metricReaders: MetricReader[] = [];

  if (configuredMetricReaders && configuredMetricReaders.length > 0) {
    // User provided custom metric readers
    metricReaders.push(...configuredMetricReaders);
  } else if (metricsEnabled) {
    for (const destination of otlpDestinations) {
      if (!destinationSupportsSignal(destination, 'metrics')) continue;

      const metricExporter = createMetricExporter(destination.protocol, {
        url: formatEndpointUrl(
          destination.endpoint,
          'metrics',
          destination.protocol,
        ),
        headers: destination.headers,
      });

      // PeriodicExportingMetricReader hardcodes 60s and only NodeSDK reads
      // these env vars, but we build the reader ourselves — so honour them
      // here. Without it a short-lived process exports once, on shutdown, and
      // rate() over those metrics returns nothing.
      // The keys are omitted rather than set to undefined: the SDK treats a
      // present key as explicitly provided and throws on interval < timeout.
      const exportIntervalMillis = readMillisEnv('OTEL_METRIC_EXPORT_INTERVAL');
      const exportTimeoutMillis = readMillisEnv('OTEL_METRIC_EXPORT_TIMEOUT');

      metricReaders.push(
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          ...(exportIntervalMillis === undefined
            ? {}
            : { exportIntervalMillis }),
          ...(exportTimeoutMillis === undefined ? {} : { exportTimeoutMillis }),
        }),
      );
    }
  }

  let logRecordProcessors: LogRecordProcessor[] | undefined;
  if (
    configuredLogRecordProcessors &&
    configuredLogRecordProcessors.length > 0
  ) {
    logRecordProcessors = [...configuredLogRecordProcessors];
  }

  // Auto-configure OTLP log exporters when logs are enabled.
  if (logsEnabled) {
    for (const destination of otlpDestinations) {
      if (!destinationSupportsSignal(destination, 'logs')) continue;

      const logExporter = createLogExporter(destination.protocol, {
        url: formatEndpointUrl(
          destination.endpoint,
          'logs',
          destination.protocol,
        ),
        headers: destination.headers,
      });

      let processor: LogRecordProcessor = new BatchLogRecordProcessor({
        exporter: logExporter,
      });
      if (_stringRedactor) {
        processor = new RedactingLogRecordProcessor(processor, _stringRedactor);
      }
      if (!logRecordProcessors) {
        logRecordProcessors = [];
      }
      logRecordProcessors.push(processor);
    }

    if (
      otlpDestinations.some((destination) =>
        destinationSupportsSignal(destination, 'logs'),
      )
    ) {
      logger.info({}, '[autotel] OTLP log exporter configured');
    }
  }

  // PostHog OTLP logs integration
  const posthogProcessors = buildPostHogLogProcessors(
    mergedConfig.posthog,
    _stringRedactor,
  );
  if (posthogProcessors.length > 0) {
    if (!logRecordProcessors) {
      logRecordProcessors = [];
    }
    logRecordProcessors.push(...posthogProcessors);
    logger.info({}, '[autotel] PostHog OTLP logs configured');
  }

  // Wrap every log processor with the policy applier so `log` policies apply on
  // all export paths. Gated on `policies` being configured, not on the policy
  // set being non-empty — the set is reloaded at runtime.
  if (mergedConfig.policies && logRecordProcessors) {
    logRecordProcessors = logRecordProcessors.map(
      (processor) => new PolicyLogRecordProcessor(processor),
    );
  }

  // Handle instrumentations: merge manual instrumentations with auto-instrumentations
  let finalInstrumentations: NodeSDKConfiguration['instrumentations'] =
    mergedConfig.instrumentations ? [...mergedConfig.instrumentations] : [];

  if (
    mergedConfig.autoInstrumentations !== undefined &&
    mergedConfig.autoInstrumentations !== false
  ) {
    // Check for ESM mode and provide guidance
    const isESM = isESMMode();
    if (isESM) {
      logger.info(
        {},
        '[autotel] ESM mode detected. For auto-instrumentation to work:\n' +
          '  1. Install @opentelemetry/auto-instrumentations-node as a direct dependency\n' +
          '  2. Import autotel/register FIRST in your instrumentation file\n' +
          '  3. Use getNodeAutoInstrumentations() directly instead of autoInstrumentations\n' +
          '  See: https://github.com/jagreehal/autotel#esm-setup',
      );
    }

    try {
      // Detect manual instrumentations to avoid conflicts
      const manualInstrumentationNames = getInstrumentationNames(
        mergedConfig.instrumentations ?? [],
      );

      // Warn if both autoInstrumentations and manual instrumentations are provided
      if (manualInstrumentationNames.size > 0) {
        const manualNames = [...manualInstrumentationNames].join(', ');
        logger.info(
          {},
          `[autotel] Detected manual instrumentations (${manualNames}). ` +
            'These will take precedence over auto-instrumentations. ' +
            'Tip: Set autoInstrumentations:false if you want full manual control, or remove manual configs to use auto-instrumentations.',
        );
      }

      const autoInstrumentations = getAutoInstrumentations(
        mergedConfig.autoInstrumentations,
        manualInstrumentationNames,
      );
      if (autoInstrumentations && autoInstrumentations.length > 0) {
        // Cast to proper type - getNodeAutoInstrumentations returns the correct type
        finalInstrumentations = [
          ...finalInstrumentations,
          ...(autoInstrumentations as NodeSDKConfiguration['instrumentations']),
        ];
      }
    } catch (error) {
      logger.warn(
        {},
        `[autotel] Failed to configure auto-instrumentations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const autotelSampler =
    mergedConfig.sampler ??
    (mergedConfig.sampling
      ? resolveSamplingPreset(mergedConfig.sampling)
      : undefined);
  if (autotelSampler) {
    mergedConfig.sampler = autotelSampler;
  }
  const sampler: OtelSampler = autotelSampler
    ? toOtelSampler(autotelSampler)
    : (envConfig.otelSampler ?? toOtelSampler(samplingPresets.production()));

  const sdkOptions: Partial<NodeSDKConfiguration> = {
    resource,
    // NodeSDK runs its environment resource detector after merging `resource`.
    // Passing serviceName separately reapplies the resolved Autotel value last,
    // preserving our documented explicit > YAML > environment precedence.
    serviceName: mergedConfig.service,
    sampler,
    instrumentations: finalInstrumentations,
  };

  if (spanProcessors.length > 0) {
    sdkOptions.spanProcessors = spanProcessors;
  }

  if (metricReaders.length > 0) {
    sdkOptions.metricReaders = metricReaders;
  }

  if (logRecordProcessors && logRecordProcessors.length > 0) {
    sdkOptions.logRecordProcessors = logRecordProcessors;
  }

  sdk = mergedConfig.sdkFactory
    ? mergedConfig.sdkFactory(sdkOptions)
    : new NodeSDK(sdkOptions);

  if (!sdk) {
    throw new Error('[autotel] sdkFactory must return a NodeSDK instance');
  }

  sdk.start();

  // Initialize OpenLLMetry if enabled (after SDK starts to reuse tracer provider)
  if (mergedConfig.openllmetry?.enabled) {
    const traceloop = _optionalRequire<{
      initialize?: (options?: Record<string, unknown>) => void;
    }>('@traceloop/node-server-sdk');

    if (traceloop) {
      const initOptions: Record<string, unknown> = {
        ...mergedConfig.openllmetry.options,
      };

      // Reuse autotel's tracer provider
      try {
        // Type assertion needed as getTracerProvider is not in the public NodeSDK interface
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tracerProvider = (sdk as any).getTracerProvider();
        initOptions.tracerProvider = tracerProvider;
      } catch {
        // Ignore if tracer provider not available
      }

      // Pass span exporter to OpenLLMetry if provided
      if (configuredSpanExporters?.[0]) {
        initOptions.exporter = configuredSpanExporters[0];
      }

      if (typeof traceloop.initialize === 'function') {
        traceloop.initialize(initOptions);
        logger.info({}, '[autotel] OpenLLMetry initialized successfully');
      } else {
        logger.warn(
          {},
          '[autotel] OpenLLMetry initialize function not found. Check @traceloop/node-server-sdk version.',
        );
      }
    } else {
      logger.warn(
        {},
        '[autotel] OpenLLMetry enabled but @traceloop/node-server-sdk is not installed. ' +
          'Install it as a peer dependency to use OpenLLMetry integration.',
      );
    }
  }

  initialized = true;
  const processHandlers = mergedConfig.processHandlers;
  const handlersConfig =
    processHandlers && processHandlers !== true ? processHandlers : {};
  if (processHandlers) {
    installProcessHandlers(handlersConfig, shutdown);
  } else {
    uninstallProcessHandlers();
  }

  // Always last: installProcessHandlers() clears the owned-handler list before
  // registering its own, so the exit flush has to go on after it.
  //
  // Unlike the signal and fatal-error handlers this is not opt-in. Those cover
  // a process that is stopped or that crashes, and neither fires when a script
  // finishes normally — the case that silently dropped whatever the batch
  // processor was still holding. Opting in cannot be the answer to a default
  // that loses data without saying so.
  //
  // A flush, not a shutdown: `beforeExit` fires on any event-loop drain, so a
  // teardown here would kill telemetry in a process that resumes work.
  // `forShutdown` still drains the subscribers, which buffer independently of
  // our queue and are the reason a CLI loses events on the way out.
  if (mergedConfig.flushOnExit !== false) {
    const timeoutMs = handlersConfig.shutdownTimeoutMs;
    installExitFlush(
      () => flush({ forShutdown: true, timeout: timeoutMs }),
      timeoutMs,
    );
  }
}

/**
 * Check if autotel has been initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Get current config (internal use)
 */
export function getConfig(): AutotelConfig | null {
  return config;
}

/**
 * Get current logger (internal use)
 */
export function getLogger(): Logger {
  return logger;
}

/**
 * Get validation config (internal use)
 */
export function getValidationConfig(): Partial<ValidationConfig> | null {
  return validationConfig;
}

/**
 * Get events config (internal use)
 */
export function getEventsConfig(): EventsConfig | null {
  return eventsConfig;
}

/**
 * Warn once if not initialized (same behavior in all environments)
 */
export function warnIfNotInitialized(context: string): void {
  if (!initialized && !warnedOnce) {
    logger.warn(
      {},
      `[autotel] ${context} used before init() called. ` +
        'Call init({ service: "..." }) first. See: https://docs.autotel.dev/quickstart',
    );
    warnedOnce = true;
  }
}

/**
 * Get default sampler
 */
export function getDefaultSampler(): Sampler {
  return config?.sampler || samplingPresets.production();
}

/**
 * Get the string redactor configured via init({ attributeRedactor }).
 * Returns null if no redactor was configured.
 */
export function getStringRedactor(): StringRedactor | null {
  return _stringRedactor;
}

/**
 * @internal Override optional require for deterministic tests.
 */
export function _setOptionalRequireForTesting(
  loader: typeof safeRequire,
): void {
  _optionalRequire = loader;
}

/**
 * @internal Reset optional require override.
 */
export function _resetOptionalRequireForTesting(): void {
  _optionalRequire = safeRequire;
}

/**
 * @internal Close embedded devtools if running.
 */
export async function _closeEmbeddedDevtools(): Promise<void> {
  if (_devtoolsClose) {
    await _devtoolsClose();
    _devtoolsClose = null;
  }
}

/**
 * @internal Get embedded devtools close handle.
 */
export function _getEmbeddedDevtoolsCloseForTesting():
  (() => Promise<void> | void) | null {
  return _devtoolsClose;
}

/**
 * Get SDK instance (for shutdown)
 */
export function getSdk(): NodeSDK | null {
  return sdk;
}
