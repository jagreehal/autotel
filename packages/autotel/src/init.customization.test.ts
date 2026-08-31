import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { NodeSDK, NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { mock, mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { NeverSampler } from './sampling';

/** The options a constructor was called with, as this harness records them. */
type SdkOptions = Partial<NodeSDKConfiguration>;

/**
 * What an exporter, reader or processor was constructed with. Each is an
 * options bag the SDK passes straight through, so the harness records it as
 * the config values it can hold rather than re-deriving each vendor's shape.
 */
type RecordedOptions = Record<string, ConfigValue>;

/** A value inside a recorded options bag. */
type ConfigValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | ((...args: never[]) => ConfigValue)
  | Array<ConfigValue>
  | { [key: string]: ConfigValue };

type SdkRecord = {
  options: SdkOptions;
  instance: DeepMockProxy<NodeSDK>;
};

async function loadInitWithMocks() {
  const sdkInstances: SdkRecord[] = [];
  const traceExporterOptions: RecordedOptions[] = [];
  const metricExporterOptions: RecordedOptions[] = [];
  const metricReaderOptions: RecordedOptions[] = [];
  const logExporterOptions: RecordedOptions[] = [];
  const logProcessorOptions: RecordedOptions[] = [];

  class MockNodeSDK {
    constructor(options: SdkOptions) {
      const instance = mockDeep<NodeSDK>();
      instance.start.mockImplementation(() => {});
      instance.shutdown.mockResolvedValue();
      sdkInstances.push({ options, instance });
      return instance;
    }
  }

  class MockOTLPTraceExporter {
    options: RecordedOptions;

    constructor(options: RecordedOptions) {
      this.options = options;
      traceExporterOptions.push(options);
    }
  }

  class MockOTLPMetricExporter {
    options: RecordedOptions;

    constructor(options: RecordedOptions) {
      this.options = options;
      metricExporterOptions.push(options);
    }
  }

  class MockPeriodicExportingMetricReader {
    options: RecordedOptions;

    constructor(options: RecordedOptions) {
      this.options = options;
      metricReaderOptions.push(options);
    }
  }

  // Reset modules immediately before mocking to ensure clean state
  vi.resetModules();

  vi.doMock('@opentelemetry/sdk-node', () => ({
    NodeSDK: MockNodeSDK,
  }));

  vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
    OTLPTraceExporter: MockOTLPTraceExporter,
  }));

  vi.doMock('@opentelemetry/exporter-metrics-otlp-http', () => ({
    OTLPMetricExporter: MockOTLPMetricExporter,
  }));

  vi.doMock('@opentelemetry/sdk-metrics', () => ({
    PeriodicExportingMetricReader: MockPeriodicExportingMetricReader,
  }));

  class MockOTLPLogExporter {
    options: RecordedOptions;

    constructor(options: RecordedOptions) {
      this.options = options;
      logExporterOptions.push(options);
    }
  }

  class MockBatchLogRecordProcessor {
    exporter: ConfigValue;

    constructor(exporter: ConfigValue) {
      this.exporter = exporter;
      logProcessorOptions.push({ exporter });
    }

    onEmit() {}
    shutdown() {
      return Promise.resolve();
    }
    forceFlush() {
      return Promise.resolve();
    }
  }

  vi.doMock('@opentelemetry/exporter-logs-otlp-http', () => ({
    OTLPLogExporter: MockOTLPLogExporter,
  }));

  vi.doMock('@opentelemetry/sdk-logs', () => ({
    BatchLogRecordProcessor: MockBatchLogRecordProcessor,
  }));

  // vi.doMock is not hoisted, so ./init must be imported after the mocks
  // above are registered; a static import would bind the unmocked module.
  // eslint-disable-next-line no-restricted-syntax
  const mod = await import('./init');

  return {
    init: mod.init,
    getConfig: mod.getConfig,
    getDefaultSampler: mod.getDefaultSampler,
    resolveLogsFlag: mod.resolveLogsFlag,
    setOptionalRequireForTesting: mod._setOptionalRequireForTesting,
    resetOptionalRequireForTesting: mod._resetOptionalRequireForTesting,
    getEmbeddedDevtoolsCloseForTesting: mod._getEmbeddedDevtoolsCloseForTesting,
    sdkInstances,
    traceExporterOptions,
    metricExporterOptions,
    metricReaderOptions,
    logExporterOptions,
    logProcessorOptions,
  };
}

describe('init() customization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AUTOTEL_METRICS;
    delete process.env.AUTOTEL_LOGS;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_TRACES_SAMPLER;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;
    delete process.env.NODE_ENV;
  });

  it('auto-configures local devtools endpoint and logs when devtools is enabled', async () => {
    const {
      init,
      sdkInstances,
      traceExporterOptions,
      metricExporterOptions,
      logExporterOptions,
    } = await loadInitWithMocks();

    init({ service: 'devtools-app', devtools: true });

    expect(traceExporterOptions[0]).toMatchObject({
      url: 'http://127.0.0.1:4318/v1/traces',
    });
    expect(metricExporterOptions[0]).toMatchObject({
      url: 'http://127.0.0.1:4318/v1/metrics',
    });
    expect(logExporterOptions[0]).toMatchObject({
      url: 'http://127.0.0.1:4318/v1/logs',
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.logRecordProcessors).toBeDefined();
  });

  it('starts embedded autotel-devtools when requested and installed', async () => {
    const {
      init,
      setOptionalRequireForTesting,
      getEmbeddedDevtoolsCloseForTesting,
      traceExporterOptions,
      logExporterOptions,
    } = await loadInitWithMocks();

    const close = vi.fn();

    setOptionalRequireForTesting((id: string) => {
      if (id === 'autotel-devtools') {
        // SAFETY: init() reaches for the devtools entry point by id and calls
        // createDevtools on what it gets; nothing else of the module is used.
        return {
          createDevtools: () => ({
            port: 9876,
            close,
          }),
        } as any;
      }
      return;
    });

    init({
      service: 'embedded-devtools-app',
      devtools: { embedded: true, host: '127.0.0.1', port: 0 },
    });

    expect(traceExporterOptions[0]).toMatchObject({
      url: 'http://127.0.0.1:9876/v1/traces',
    });
    expect(logExporterOptions[0]).toMatchObject({
      url: 'http://127.0.0.1:9876/v1/logs',
    });
    expect(getEmbeddedDevtoolsCloseForTesting()).toBe(close);
  });

  it('falls back cleanly when embedded devtools is requested but unavailable', async () => {
    const { init, setOptionalRequireForTesting, traceExporterOptions } =
      await loadInitWithMocks();

    setOptionalRequireForTesting(() => {});

    init({
      service: 'embedded-devtools-fallback-app',
      devtools: { embedded: true },
    });

    expect(traceExporterOptions[0]).toMatchObject({
      url: 'http://127.0.0.1:4318/v1/traces',
    });
  });

  it(
    'passes custom instrumentations to the NodeSDK',
    { timeout: 10_000 },
    async () => {
      const { init, sdkInstances } = await loadInitWithMocks();

      // SAFETY: init() only forwards instrumentations to the SDK; a name is all
      // this test needs to identify the one it passed in.
      const instrumentation = { name: 'http' } as any;

      init({
        service: 'instrumented-app',
        instrumentations: [instrumentation],
      });

      // init() constructs exactly one SDK, so the last record is this run's.
      const options = sdkInstances.at(-1)!.options;
      expect(options.instrumentations).toBeDefined();
      expect(options.instrumentations).toContain(instrumentation);
    },
  );

  it('merges resource attributes with defaults', async () => {
    const { init, getConfig, sdkInstances } = await loadInitWithMocks();

    init({
      service: 'resource-app',
      resourceAttributes: { 'cloud.region': 'eu-central-1' },
    });

    // SAFETY: init() always passes a resource; the fields read below are the
    // ones it fills in from the service config.
    const resource = sdkInstances.at(-1)?.options.resource as
      | {
          attributes?: Record<string, ConfigValue>;
        }
      | undefined;

    if (resource?.attributes) {
      expect(resource.attributes['cloud.region']).toBe('eu-central-1');
      expect(resource.attributes['service.name']).toBe('resource-app');
      return;
    }

    const config = getConfig();
    expect(config).not.toBeNull();
    expect(config!.service).toBe('resource-app');
    expect(config!.resourceAttributes).toMatchObject({
      'cloud.region': 'eu-central-1',
    });
  });

  it('passes the resolved service name to NodeSDK', async () => {
    const previousServiceName = process.env.OTEL_SERVICE_NAME;
    process.env.OTEL_SERVICE_NAME = 'service-from-environment';

    try {
      const { init, sdkInstances } = await loadInitWithMocks();

      init({ service: 'service-from-code' });

      expect(sdkInstances.at(-1)?.options.serviceName).toBe(
        'service-from-code',
      );
    } finally {
      if (previousServiceName === undefined) {
        delete process.env.OTEL_SERVICE_NAME;
      } else {
        process.env.OTEL_SERVICE_NAME = previousServiceName;
      }
    }
  });

  it('creates a default OTLP metric reader when metrics enabled', async () => {
    const { init, metricReaderOptions, metricExporterOptions } =
      await loadInitWithMocks();

    init({ service: 'metrics-app', endpoint: 'http://localhost:4318' });

    expect(metricReaderOptions).toHaveLength(1);
    expect(metricExporterOptions).toHaveLength(1);
  });

  it('honours OTEL_METRIC_EXPORT_INTERVAL, and omits the key when unset', async () => {
    const previous = process.env.OTEL_METRIC_EXPORT_INTERVAL;

    try {
      process.env.OTEL_METRIC_EXPORT_INTERVAL = '5000';
      const withEnv = await loadInitWithMocks();
      withEnv.init({
        service: 'fast-metrics',
        endpoint: 'http://localhost:4318',
      });
      expect(withEnv.metricReaderOptions[0]?.exportIntervalMillis).toBe(5000);

      // A present-but-undefined key counts as explicitly provided to the SDK
      // and makes it throw on the default 30s timeout, so it must be absent.
      delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
      const withoutEnv = await loadInitWithMocks();
      withoutEnv.init({
        service: 'default-metrics',
        endpoint: 'http://localhost:4318',
      });
      expect(withoutEnv.metricReaderOptions[0]).not.toHaveProperty(
        'exportIntervalMillis',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
      } else {
        process.env.OTEL_METRIC_EXPORT_INTERVAL = previous;
      }
    }
  });

  it('skips default metric reader when metrics disabled', async () => {
    const { init, metricReaderOptions } = await loadInitWithMocks();

    init({ service: 'no-metrics', metrics: false });

    expect(metricReaderOptions).toHaveLength(0);
  });

  it('respects custom metric readers', async () => {
    const { init, sdkInstances, metricReaderOptions } =
      await loadInitWithMocks();
    const customMetricReader = mock<MetricReader>();

    init({ service: 'custom-metrics', metricReaders: [customMetricReader] });

    expect(sdkInstances).toHaveLength(1);
    // SAFETY: as above - the last record is this run's SDK options.
    const options = sdkInstances.at(-1)!.options;
    expect(options.metricReaders).toEqual([customMetricReader]);
    expect(metricReaderOptions).toHaveLength(0);
  });

  it('supports singular metricReader alias', async () => {
    const { init, sdkInstances, metricReaderOptions } =
      await loadInitWithMocks();
    const customMetricReader = mock<MetricReader>();

    init({ service: 'custom-metric-alias', metricReader: customMetricReader });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.metricReaders).toEqual([customMetricReader]);
    expect(metricReaderOptions).toHaveLength(0);
  });

  it('applies OTLP headers for default exporters', async () => {
    const { init, traceExporterOptions, metricExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'headers-app',
      endpoint: 'http://localhost:4318',
      headers: 'Authorization=Basic abc123',
    });

    expect(traceExporterOptions[0]).toMatchObject({
      headers: { Authorization: 'Basic abc123' },
    });

    expect(metricExporterOptions[0]).toMatchObject({
      headers: { Authorization: 'Basic abc123' },
    });
  });

  it('supports declarative multi-destination OTLP fan-out', async () => {
    const {
      init,
      traceExporterOptions,
      metricExporterOptions,
      logExporterOptions,
      metricReaderOptions,
    } = await loadInitWithMocks();

    init({
      service: 'fanout-app',
      logs: true,
      destinations: [
        {
          endpoint: 'https://otlp-gateway.grafana.net/otlp',
          headers: { Authorization: 'Basic grafana' },
        },
        {
          endpoint: 'https://api.honeycomb.io',
          headers: { 'x-honeycomb-team': 'hny' },
          signals: ['traces'],
        },
      ],
    });

    expect(traceExporterOptions).toHaveLength(2);
    expect(traceExporterOptions[0]).toMatchObject({
      url: 'https://otlp-gateway.grafana.net/otlp/v1/traces',
      headers: { Authorization: 'Basic grafana' },
    });
    expect(traceExporterOptions[1]).toMatchObject({
      url: 'https://api.honeycomb.io/v1/traces',
      headers: { 'x-honeycomb-team': 'hny' },
    });

    expect(metricExporterOptions).toHaveLength(1);
    expect(metricExporterOptions[0]).toMatchObject({
      url: 'https://otlp-gateway.grafana.net/otlp/v1/metrics',
    });
    expect(metricReaderOptions).toHaveLength(1);

    expect(logExporterOptions).toHaveLength(1);
    expect(logExporterOptions[0]).toMatchObject({
      url: 'https://otlp-gateway.grafana.net/otlp/v1/logs',
    });
  });

  it('lets destinations inherit top-level protocol and headers', async () => {
    const { init, traceExporterOptions, metricExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'fanout-inherited',
      protocol: 'http',
      headers: 'Authorization=Bearer shared',
      destinations: [
        { endpoint: 'https://grafana.example.com/otlp' },
        { endpoint: 'https://honeycomb.example.com' },
      ],
    });

    expect(traceExporterOptions).toHaveLength(2);
    expect(traceExporterOptions[0]).toMatchObject({
      headers: { Authorization: 'Bearer shared' },
    });
    expect(traceExporterOptions[1]).toMatchObject({
      headers: { Authorization: 'Bearer shared' },
    });
    expect(metricExporterOptions).toHaveLength(2);
  });

  it('resolves sampling preset shorthand to a sampler instance', async () => {
    const { init, getDefaultSampler } = await loadInitWithMocks();

    init({
      service: 'sampling-preset-app',
      sampling: 'development',
    });

    const sampler = getDefaultSampler();
    expect(sampler.constructor.name).toBe('AlwaysSampler');
    expect(sampler.shouldSample({ operationName: 'test', args: [] })).toBe(
      true,
    );
  });

  it('prefers explicit sampler over sampling preset shorthand', async () => {
    const { init, getDefaultSampler } = await loadInitWithMocks();
    const explicitSampler = new NeverSampler();

    init({
      service: 'sampling-precedence-app',
      sampler: explicitSampler,
      sampling: 'development',
    });

    expect(getDefaultSampler()).toBe(explicitSampler);
  });

  it('uses OTEL_TRACES_SAMPLER when no explicit sampling config is provided', async () => {
    process.env.OTEL_TRACES_SAMPLER = 'always_off';
    const { init, sdkInstances } = await loadInitWithMocks();

    init({
      service: 'env-sampler-app',
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: a Sampler names itself through toString(), which is what init()
    // is being checked to have configured.
    expect((options.sampler as { toString(): string }).toString()).toContain(
      'AlwaysOffSampler',
    );
  });

  it('prefers explicit sampling config over OTEL_TRACES_SAMPLER', async () => {
    process.env.OTEL_TRACES_SAMPLER = 'always_off';
    const { init, sdkInstances } = await loadInitWithMocks();

    init({
      service: 'explicit-over-env-sampler-app',
      sampling: 'development',
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: a Sampler names itself through toString(), which is what init()
    // is being checked to have configured.
    expect((options.sampler as { toString(): string }).toString()).toBe(
      'AutotelSamplerAdapter',
    );
  });

  it('supports sdkFactory overrides', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();
    const customSdk = mockDeep<NodeSDK>();
    customSdk.start.mockImplementation(() => {});
    customSdk.shutdown.mockResolvedValue();

    init({
      service: 'custom-sdk',
      endpoint: 'http://localhost:4318',
      metrics: false,
      sdkFactory: (defaults) => {
        expect(defaults.spanProcessors).toBeDefined();
        return customSdk;
      },
    });

    expect(sdkInstances).toHaveLength(0);
    expect(customSdk.start).toHaveBeenCalled();
  });

  it('exports nothing but still traces when no endpoint is configured', async () => {
    // Omitting the key lets NodeSDK install its own default exporter, which is
    // OTLP to http://localhost:4318. That turns "no endpoint configured" into
    // "export to localhost" — a doomed request per batch on any server with
    // nothing listening there, and no error naming the cause.
    //
    // An empty array is not the answer either: NodeSDK registers no
    // TracerProvider for one, so nothing records, `traceparent` stops being
    // injected, and a service with no endpoint of its own can no longer pass
    // the trace on. One processor that does nothing keeps the provider.
    const { init, sdkInstances, traceExporterOptions } =
      await loadInitWithMocks();

    init({ service: 'no-endpoint', metrics: false });

    const options = sdkInstances.at(-1)!.options;
    expect(traceExporterOptions).toHaveLength(0);
    expect(options.spanProcessors).toHaveLength(1);
    expect(options.spanProcessors![0]!.constructor.name).toBe(
      'NoopSpanProcessor',
    );
  });

  it('passes an empty logRecordProcessors array when nothing is configured', async () => {
    // The logs half of the same default: absent means NodeSDK builds its own
    // OTLP log exporter to http://localhost:4318, so canonical log lines and
    // events land at a collector nobody configured.
    const { init, sdkInstances } = await loadInitWithMocks();

    init({ service: 'no-endpoint-logs', metrics: false });

    expect(sdkInstances.at(-1)!.options.logRecordProcessors).toEqual([]);
  });

  it('still builds a log processor from a configured endpoint', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();

    init({
      service: 'has-endpoint-logs',
      endpoint: 'http://localhost:4318',
      metrics: false,
      logs: true,
    });

    expect(
      sdkInstances.at(-1)!.options.logRecordProcessors!.length,
    ).toBeGreaterThan(0);
  });

  it('honours an explicit empty spanProcessors as an off switch', async () => {
    // Empty and absent used to be indistinguishable, so a caller asking for
    // no processors silently got NodeSDK's default one instead.
    const { init, sdkInstances, traceExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'explicitly-off',
      endpoint: 'http://localhost:4318',
      spanProcessors: [],
    });

    expect(traceExporterOptions).toHaveLength(0);
    expect(
      sdkInstances.at(-1)!.options.spanProcessors![0]!.constructor.name,
    ).toBe('NoopSpanProcessor');
  });

  it('still builds a processor from a configured endpoint', async () => {
    // The other half of the guard: switching off the localhost default must not
    // switch off exporting when an endpoint really is configured.
    const { init, sdkInstances } = await loadInitWithMocks();

    init({
      service: 'has-endpoint',
      endpoint: 'http://localhost:4318',
      metrics: false,
    });

    expect(sdkInstances.at(-1)!.options.spanProcessors!.length).toBeGreaterThan(
      0,
    );
  });

  it('lets an explicit empty spanProcessors win over the singular spanProcessor', async () => {
    // Pinning the precedence the "empty means empty" change introduces: the
    // plural key is the more specific statement, so [] means none even when a
    // singular processor is also present.
    const { init, sdkInstances } = await loadInitWithMocks();
    const singular = mock<SpanProcessor>();
    singular.shutdown.mockResolvedValue();
    singular.forceFlush.mockResolvedValue();

    init({
      service: 'precedence',
      spanProcessors: [],
      spanProcessor: singular,
    });

    const processors = sdkInstances.at(-1)!.options.spanProcessors!;
    expect(processors).toHaveLength(1);
    expect(processors[0]!.constructor.name).toBe('NoopSpanProcessor');
    expect(processors).not.toContain(singular);
  });

  it('uses provided spanProcessors when supplied', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();
    const customProcessor = mock<SpanProcessor>();
    customProcessor.shutdown.mockResolvedValue();
    customProcessor.forceFlush.mockResolvedValue();

    init({ service: 'custom-span', spanProcessors: [customProcessor] });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.spanProcessors).toEqual([customProcessor]);
  });

  it('adds spanEnrichers to the destination pipeline instead of replacing it', async () => {
    // The distinction that matters: `spanProcessors` takes over the pipeline,
    // so a processor that only decorates spans would silently switch off every
    // configured destination. Enrichers compose with them, and run first so the
    // exporters see the decorated span.
    const { init, sdkInstances } = await loadInitWithMocks();
    const enricher = mock<SpanProcessor>();
    enricher.shutdown.mockResolvedValue();
    enricher.forceFlush.mockResolvedValue();

    init({
      service: 'enriched',
      endpoint: 'http://localhost:4318',
      spanEnrichers: [enricher],
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: init() passes the processors it built; the assertions below are
    // about which ones ended up in that list.
    const processors = options.spanProcessors as SpanProcessor[];
    expect(processors[0]).toBe(enricher);
    expect(processors.length).toBeGreaterThan(1);
  });

  it.each([
    ['' as const, 'no prefix'],
    ['ctx' as const, 'a custom prefix'],
    [true as const, 'the default prefix'],
  ])(
    'installs the baggage processor when baggage is %o (%s)',
    async (baggage, _description) => {
      // `baggage: ''` is documented as "copy baggage onto spans, unprefixed" —
      // the falsy empty string must not read as "baggage off". Getting this
      // wrong is silent: spans simply never carry the entries.
      const { init, sdkInstances } = await loadInitWithMocks();

      init({
        service: 'baggage-app',
        endpoint: 'http://localhost:4318',
        baggage,
      });

      // init() constructs exactly one SDK, so the last record is this run's.
      const options = sdkInstances.at(-1)!.options;
      // SAFETY: init() passes the processors it built; this asserts which ones.
      const processors = options.spanProcessors as SpanProcessor[];
      expect(
        processors.map((processor) => processor.constructor.name),
      ).toContain('BaggageSpanProcessor');
    },
  );

  it('leaves the baggage processor out when baggage is off', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();

    init({ service: 'no-baggage-app', endpoint: 'http://localhost:4318' });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: init() passes the processors it built; this asserts which ones.
    const processors = options.spanProcessors as SpanProcessor[];
    expect(
      processors.map((processor) => processor.constructor.name),
    ).not.toContain('BaggageSpanProcessor');
  });

  it('keeps spanEnrichers outside the redaction wrapper', async () => {
    // AttributeRedactingProcessor hands its wrapped processor a proxy whose
    // `attributes` is a private redacted copy. An enricher wrapped by it would
    // decorate that copy while every exporter received its own copy taken from
    // the original span, so the enrichment would reach no destination, and only
    // when redaction happened to be configured.
    const { init, sdkInstances } = await loadInitWithMocks();
    const enricher = mock<SpanProcessor>();
    enricher.shutdown.mockResolvedValue();
    enricher.forceFlush.mockResolvedValue();

    init({
      service: 'enriched-redacted',
      endpoint: 'http://localhost:4318',
      attributeRedactor: { patterns: [/password/] },
      spanEnrichers: [enricher],
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: init() passes the processors it built; the assertions below are
    // about which ones ended up in that list.
    const processors = options.spanProcessors as SpanProcessor[];
    // Identity, not just position: the enricher reaches the SDK unwrapped, so
    // it mutates the real span. Compared by constructor name because
    // `vi.resetModules()` gives `init` its own copy of the class.
    expect(processors[0]).toBe(enricher);
    expect(processors[0]?.constructor.name).not.toBe(
      'AttributeRedactingProcessor',
    );
    // The exporting processors are still wrapped.
    expect(processors.length).toBeGreaterThan(1);
    expect(processors[1]?.constructor.name).toBe('AttributeRedactingProcessor');
  });

  it('supports singular spanProcessor alias', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();
    const customProcessor = mock<SpanProcessor>();
    customProcessor.shutdown.mockResolvedValue();
    customProcessor.forceFlush.mockResolvedValue();

    init({ service: 'custom-span-alias', spanProcessor: customProcessor });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.spanProcessors).toEqual([customProcessor]);
  });

  it('prefers plural spanProcessors over singular spanProcessor when both are set', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();
    const pluralProcessor = mock<SpanProcessor>();
    pluralProcessor.shutdown.mockResolvedValue();
    pluralProcessor.forceFlush.mockResolvedValue();
    const singularProcessor = mock<SpanProcessor>();
    singularProcessor.shutdown.mockResolvedValue();
    singularProcessor.forceFlush.mockResolvedValue();

    init({
      service: 'custom-span-precedence',
      spanProcessor: singularProcessor,
      spanProcessors: [pluralProcessor],
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.spanProcessors).toEqual([pluralProcessor]);
  });

  it('supports singular spanExporter alias', async () => {
    const { init, sdkInstances, traceExporterOptions } =
      await loadInitWithMocks();
    // SAFETY: a SpanExporter is used for export() and shutdown(); the assertion
    // at the end of this literal covers the rest of the interface.
    const customExporter = {
      export: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      forceFlush: vi.fn().mockResolvedValue(undefined),
    } as any;

    init({
      service: 'custom-exporter-alias',
      endpoint: 'http://localhost:4318',
      spanExporter: customExporter,
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.spanProcessors).toBeDefined();
    // Custom exporter path should bypass default OTLP trace exporter creation.
    expect(traceExporterOptions).toHaveLength(0);
  });

  it('auto-configures OTLP log exporter when logs enabled with endpoint', async () => {
    const { init, sdkInstances, logExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'log-app',
      endpoint: 'http://localhost:4318',
      logs: true,
    });

    expect(logExporterOptions).toHaveLength(1);
    expect(logExporterOptions[0]!.url).toBe('http://localhost:4318/v1/logs');
    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.logRecordProcessors).toBeDefined();
    expect(
      // SAFETY: only the count of configured processors is read here.
      (options.logRecordProcessors as unknown[]).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('auto-configures OTLP logs for canonical lines with otel enabled', async () => {
    const { init, sdkInstances, logExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'grafana-log-app',
      endpoint: 'http://localhost:4318',
      canonicalLogLines: {
        enabled: true,
        logger: mock<import('./logger').Logger>(),
        otel: true,
      },
    });

    expect(logExporterOptions).toHaveLength(1);
    expect(logExporterOptions[0]!.url).toBe('http://localhost:4318/v1/logs');
    expect(sdkInstances.at(-1)!.options.logRecordProcessors).toBeDefined();
  });

  it('lets logs false override canonical otel export', async () => {
    const { init, logExporterOptions } = await loadInitWithMocks();

    init({
      service: 'no-grafana-logs',
      endpoint: 'http://localhost:4318',
      logs: false,
      canonicalLogLines: { enabled: true, otel: true },
    });

    expect(logExporterOptions).toHaveLength(0);
  });

  it('supports singular logRecordProcessor alias', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();
    const customLogProcessor = mock<LogRecordProcessor>();
    customLogProcessor.shutdown.mockResolvedValue();
    customLogProcessor.forceFlush.mockResolvedValue();

    init({
      service: 'custom-log-alias',
      logRecordProcessor: customLogProcessor,
    });

    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.logRecordProcessors).toEqual([customLogProcessor]);
  });

  it('does not auto-configure logs when logRecordProcessors are omitted', async () => {
    const { init, sdkInstances, logExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'default-logs',
      endpoint: 'http://localhost:4318',
    });

    expect(logExporterOptions).toHaveLength(0);
    // Empty, not absent: absent is what makes NodeSDK build its own OTLP log
    // exporter to http://localhost:4318, which is not "logs off".
    const options = sdkInstances.at(-1)!.options;
    expect(options.logRecordProcessors).toEqual([]);
  });

  it('does not override OTEL_LOGS_EXPORTER env configuration by default', async () => {
    const { init, sdkInstances, logExporterOptions } =
      await loadInitWithMocks();

    process.env.OTEL_LOGS_EXPORTER = 'none';

    init({
      service: 'env-logs',
      endpoint: 'http://localhost:4318',
    });

    expect(logExporterOptions).toHaveLength(0);
    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    expect(options.logRecordProcessors).toBeUndefined();
  });

  it('auto-configures logs when logs: true is set', async () => {
    const { init, logExporterOptions } = await loadInitWithMocks();

    init({
      service: 'default-logs',
      endpoint: 'http://localhost:4318',
      logs: true,
    });

    expect(logExporterOptions).toHaveLength(1);
  });

  it('skips log exporter when logs: false', async () => {
    const { init, logExporterOptions } = await loadInitWithMocks();

    init({
      service: 'no-logs',
      endpoint: 'http://localhost:4318',
      logs: false,
    });

    expect(logExporterOptions).toHaveLength(0);
  });

  it('skips log exporter when no endpoint', async () => {
    const { init, logExporterOptions } = await loadInitWithMocks();

    init({ service: 'no-endpoint', logs: true });

    expect(logExporterOptions).toHaveLength(0);
  });

  it('respects AUTOTEL_LOGS env var override', async () => {
    const { resolveLogsFlag } = await loadInitWithMocks();

    process.env.AUTOTEL_LOGS = 'off';
    expect(resolveLogsFlag(true)).toBe(false);

    process.env.AUTOTEL_LOGS = 'on';
    expect(resolveLogsFlag(false)).toBe(true);

    delete process.env.AUTOTEL_LOGS;
    expect(resolveLogsFlag(true)).toBe(true);
    expect(resolveLogsFlag(false)).toBe(false);
  });

  it('passes OTLP headers to log exporter', async () => {
    const { init, logExporterOptions } = await loadInitWithMocks();

    init({
      service: 'headers-logs',
      endpoint: 'http://localhost:4318',
      logs: true,
      headers: { Authorization: 'Bearer token' },
    });

    expect(logExporterOptions).toHaveLength(1);
    expect(logExporterOptions[0]!.headers).toEqual({
      Authorization: 'Bearer token',
    });
  });
});
