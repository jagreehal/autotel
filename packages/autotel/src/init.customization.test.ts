import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { mock, mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AlwaysSampler, NeverSampler } from './sampling';

type SdkRecord = {
  options: Record<string, unknown>;
  instance: DeepMockProxy<NodeSDK>;
};

async function loadInitWithMocks() {
  const sdkInstances: SdkRecord[] = [];
  const traceExporterOptions: Record<string, unknown>[] = [];
  const metricExporterOptions: Record<string, unknown>[] = [];
  const metricReaderOptions: Record<string, unknown>[] = [];
  const logExporterOptions: Record<string, unknown>[] = [];
  const logProcessorOptions: Record<string, unknown>[] = [];

  class MockNodeSDK {
    constructor(options: Record<string, unknown>) {
      const instance = mockDeep<NodeSDK>();
      instance.start.mockImplementation(() => {});
      instance.shutdown.mockResolvedValue();
      sdkInstances.push({ options, instance });
      return instance;
    }
  }

  class MockOTLPTraceExporter {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      traceExporterOptions.push(options);
    }
  }

  class MockOTLPMetricExporter {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      metricExporterOptions.push(options);
    }
  }

  class MockPeriodicExportingMetricReader {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
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
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      logExporterOptions.push(options);
    }
  }

  class MockBatchLogRecordProcessor {
    exporter: unknown;

    constructor(exporter: unknown) {
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

  const mod = await import('./init');

  return {
    init: mod.init,
    getConfig: mod.getConfig,
    getDefaultSampler: mod.getDefaultSampler,
    resolveLogsFlag: mod.resolveLogsFlag,
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

  it(
    'passes custom instrumentations to the NodeSDK',
    { timeout: 10_000 },
    async () => {
      const { init, sdkInstances } = await loadInitWithMocks();

      const instrumentation = { name: 'http' } as any;

      init({
        service: 'instrumented-app',
        instrumentations: [instrumentation],
      });

      const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
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

    const resource = sdkInstances.at(-1)?.options.resource as
      | {
          attributes?: Record<string, unknown>;
        }
      | undefined;

    if (resource?.attributes) {
      expect(resource.attributes['cloud.region']).toBe('eu-central-1');
      expect(resource.attributes['service.name']).toBe('resource-app');
      return;
    }

    const config = getConfig();
    expect(config.service).toBe('resource-app');
    expect(config.resourceAttributes).toMatchObject({
      'cloud.region': 'eu-central-1',
    });
  });

  it('creates a default OTLP metric reader when metrics enabled', async () => {
    const { init, metricReaderOptions, metricExporterOptions } =
      await loadInitWithMocks();

    init({ service: 'metrics-app', endpoint: 'http://localhost:4318' });

    expect(metricReaderOptions).toHaveLength(1);
    expect(metricExporterOptions).toHaveLength(1);
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
    const options = sdkInstances.at(-1)!.options as Record<string, unknown>;
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

    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
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

    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
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

  it('uses provided spanProcessors when supplied', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();
    const customProcessor = mock<SpanProcessor>();
    customProcessor.shutdown.mockResolvedValue();
    customProcessor.forceFlush.mockResolvedValue();

    init({ service: 'custom-span', spanProcessors: [customProcessor] });

    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    expect(options.spanProcessors).toEqual([customProcessor]);
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
    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    expect(options.logRecordProcessors).toBeDefined();
    expect(
      (options.logRecordProcessors as unknown[]).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('does not auto-configure logs when logRecordProcessors are omitted', async () => {
    const { init, sdkInstances, logExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'default-logs',
      endpoint: 'http://localhost:4318',
    });

    expect(logExporterOptions).toHaveLength(0);
    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    expect(options.logRecordProcessors).toBeUndefined();
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
    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
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
