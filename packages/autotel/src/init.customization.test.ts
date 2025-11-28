import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { mock, mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

type SdkRecord = {
  options: Record<string, unknown>;
  instance: DeepMockProxy<NodeSDK>;
};

const mockedModules = [
  '@opentelemetry/sdk-node',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/sdk-metrics',
];

async function loadInitWithMocks() {
  const sdkInstances: SdkRecord[] = [];
  const traceExporterOptions: Record<string, unknown>[] = [];
  const metricExporterOptions: Record<string, unknown>[] = [];
  const metricReaderOptions: Record<string, unknown>[] = [];

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

  const mod = await import('./init');

  return {
    init: mod.init,
    getConfig: mod.getConfig,
    sdkInstances,
    traceExporterOptions,
    metricExporterOptions,
    metricReaderOptions,
  };
}

describe('init() customization', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const mod of mockedModules) {
      vi.doUnmock(mod);
    }
    vi.clearAllMocks();
    delete process.env.AUTOTEL_METRICS;
    delete process.env.NODE_ENV;
  });

  it('passes custom instrumentations to the NodeSDK', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();

    const instrumentation = { name: 'http' } as any;

    init({ service: 'instrumented-app', instrumentations: [instrumentation] });

    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    expect(options.instrumentations).toBeDefined();
    expect(options.instrumentations).toContain(instrumentation);
  });

  it('merges resource attributes with defaults', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();

    init({
      service: 'resource-app',
      resourceAttributes: { 'cloud.region': 'eu-central-1' },
    });

    const resource = sdkInstances.at(-1)?.options.resource as {
      attributes: Record<string, unknown>;
    };
    expect(resource.attributes['cloud.region']).toBe('eu-central-1');
    expect(resource.attributes['service.name']).toBe('resource-app');
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

    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    expect(options.metricReaders).toEqual([customMetricReader]);
    expect(metricReaderOptions).toHaveLength(0);
  });

  it('applies OTLP headers for default exporters', async () => {
    const { init, traceExporterOptions, metricExporterOptions } =
      await loadInitWithMocks();

    init({
      service: 'headers-app',
      endpoint: 'http://localhost:4318',
      otlpHeaders: 'Authorization=Basic abc123',
    });

    expect(traceExporterOptions[0]).toMatchObject({
      headers: { Authorization: 'Basic abc123' },
    });

    expect(metricExporterOptions[0]).toMatchObject({
      headers: { Authorization: 'Basic abc123' },
    });
  });

  it('supports sdkFactory overrides', async () => {
    const { init, sdkInstances } = await loadInitWithMocks();
    const customSdk = mockDeep<NodeSDK>();
    customSdk.start.mockImplementation(() => {});
    customSdk.shutdown.mockResolvedValue();

    init({
      service: 'custom-sdk',
      endpoint: 'http://localhost:4318',
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
});
