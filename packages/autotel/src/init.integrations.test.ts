import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep } from 'vitest-mock-extended';
import {
  _setAutoInstrumentationsLoader,
  _resetAutoInstrumentationsLoader,
  type AutoInstrumentationsLoader,
} from './init';

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

// Mock instrumentation classes with exact names from OpenTelemetry
class MongoDBInstrumentation {
  constructor(public config?: Record<string, unknown>) {}
}

class MongooseInstrumentation {
  constructor(public config?: Record<string, unknown>) {}
}

class HttpInstrumentation {
  constructor(public config?: Record<string, unknown>) {}
}

async function loadInitWithMocks() {
  const sdkInstances: SdkRecord[] = [];
  const traceExporterOptions: Record<string, unknown>[] = [];
  const metricExporterOptions: Record<string, unknown>[] = [];
  const autoInstrumentationsConfig: Record<string, { enabled?: boolean }>[] =
    [];
  const logMessages: {
    level: string;
    message: string;
  }[] = [];

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
    constructor(public options: Record<string, unknown>) {}
  }

  // Mock getNodeAutoInstrumentations function
  const mockGetNodeAutoInstrumentations = vi.fn(
    (config?: Record<string, { enabled?: boolean }>) => {
      if (config) {
        autoInstrumentationsConfig.push(config);
      }

      // Simulate returning auto-instrumentations based on config
      const instrumentations: unknown[] = [];

      // If MongoDB is not explicitly disabled, add it
      if (
        !config ||
        !config['@opentelemetry/instrumentation-mongodb'] ||
        config['@opentelemetry/instrumentation-mongodb'].enabled !== false
      ) {
        instrumentations.push(new MongoDBInstrumentation());
      }

      // If Mongoose is not explicitly disabled, add it
      if (
        !config ||
        !config['@opentelemetry/instrumentation-mongoose'] ||
        config['@opentelemetry/instrumentation-mongoose'].enabled !== false
      ) {
        instrumentations.push(new MongooseInstrumentation());
      }

      // If HTTP is not explicitly disabled, add it
      if (
        !config ||
        !config['@opentelemetry/instrumentation-http'] ||
        config['@opentelemetry/instrumentation-http'].enabled !== false
      ) {
        instrumentations.push(new HttpInstrumentation());
      }

      return instrumentations;
    },
  );

  // Mock logger to capture log messages
  const mockLogger = {
    info: vi.fn((msg: string) => {
      logMessages.push({ level: 'info', message: msg });
    }),
    warn: vi.fn((msg: string) => {
      logMessages.push({ level: 'warn', message: msg });
    }),
    error: vi.fn((msg: string) => {
      logMessages.push({ level: 'error', message: msg });
    }),
    debug: vi.fn((msg: string) => {
      logMessages.push({ level: 'debug', message: msg });
    }),
  };

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

  const initModule = await import('./init');

  // Inject the mock loader via the exported setter
  initModule._setAutoInstrumentationsLoader(
    () => mockGetNodeAutoInstrumentations as AutoInstrumentationsLoader,
  );

  return {
    init: initModule.init,
    getConfig: initModule.getConfig,
    sdkInstances,
    traceExporterOptions,
    metricExporterOptions,
    autoInstrumentationsConfig,
    logMessages,
    mockLogger,
    mockGetNodeAutoInstrumentations,
    initModule,
  };
}

describe('init() integrations vs instrumentations', () => {
  beforeEach(() => {
    vi.resetModules();
    _resetAutoInstrumentationsLoader();
  });

  afterEach(() => {
    for (const mod of mockedModules) {
      vi.doUnmock(mod);
    }
    vi.clearAllMocks();
    _resetAutoInstrumentationsLoader();
    delete process.env.AUTOTEL_METRICS;
  });

  it('excludes manual instrumentations from auto-instrumentations when integrations: true', async () => {
    const {
      init,
      sdkInstances,
      autoInstrumentationsConfig,
      mockLogger,
      logMessages,
    } = await loadInitWithMocks();

    const manualMongoDBInstrumentation = new MongoDBInstrumentation({
      requireParentSpan: false,
    });
    const manualMongooseInstrumentation = new MongooseInstrumentation({
      requireParentSpan: false,
    });

    init({
      service: 'test-app',
      integrations: true,
      instrumentations: [
        manualMongoDBInstrumentation,
        manualMongooseInstrumentation,
      ],
      logger: mockLogger,
    });

    // Check that auto-instrumentations were called with exclusion config
    expect(autoInstrumentationsConfig).toHaveLength(1);
    const config = autoInstrumentationsConfig[0];
    expect(config['@opentelemetry/instrumentation-mongodb']).toEqual({
      enabled: false,
    });
    expect(config['@opentelemetry/instrumentation-mongoose']).toEqual({
      enabled: false,
    });

    // Check that manual instrumentations are in the final list
    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    const instrumentations = options.instrumentations as unknown[];
    expect(instrumentations).toContain(manualMongoDBInstrumentation);
    expect(instrumentations).toContain(manualMongooseInstrumentation);

    // Check that warning was logged about detected manual instrumentations
    const manualInstrumentationWarnings = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(manualInstrumentationWarnings).toHaveLength(1);
    expect(manualInstrumentationWarnings[0].message).toContain(
      'Detected manual instrumentations',
    );
    expect(manualInstrumentationWarnings[0].message).toContain(
      'MongoDBInstrumentation',
    );
    expect(manualInstrumentationWarnings[0].message).toContain(
      'MongooseInstrumentation',
    );
  });

  it('excludes manual instrumentations from specific auto-integrations list', async () => {
    const {
      init,
      sdkInstances,
      autoInstrumentationsConfig,
      mockLogger,
      logMessages,
    } = await loadInitWithMocks();

    const manualMongoDBInstrumentation = new MongoDBInstrumentation({
      requireParentSpan: false,
    });

    init({
      service: 'test-app',
      integrations: ['http', 'mongodb'],
      instrumentations: [manualMongoDBInstrumentation],
      logger: mockLogger,
    });

    // Check that auto-instrumentations were called with MongoDB disabled
    expect(autoInstrumentationsConfig).toHaveLength(1);
    const config = autoInstrumentationsConfig[0];
    expect(config['@opentelemetry/instrumentation-mongodb']).toEqual({
      enabled: false,
    });
    expect(config['@opentelemetry/instrumentation-http']).toEqual({
      enabled: true,
    });

    // Check that manual MongoDB instrumentation is in the final list
    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    const instrumentations = options.instrumentations as unknown[];
    expect(instrumentations).toContain(manualMongoDBInstrumentation);

    // Check that warning was logged about detected manual instrumentations
    const manualInstrumentationWarnings = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(manualInstrumentationWarnings).toHaveLength(1);
    expect(manualInstrumentationWarnings[0].message).toContain(
      'MongoDBInstrumentation',
    );
  });

  it('does not log warning when no manual instrumentations provided', async () => {
    const { init, mockLogger, logMessages } = await loadInitWithMocks();

    init({
      service: 'test-app',
      integrations: true,
      logger: mockLogger,
    });

    // Check that no warning was logged
    const infoMessages = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(infoMessages).toHaveLength(0);
  });

  it('does not log warning when integrations is false', async () => {
    const { init, mockLogger, logMessages } = await loadInitWithMocks();

    const manualMongoDBInstrumentation = new MongoDBInstrumentation({
      requireParentSpan: false,
    });

    init({
      service: 'test-app',
      integrations: false,
      instrumentations: [manualMongoDBInstrumentation],
      logger: mockLogger,
    });

    // Check that no warning was logged
    const infoMessages = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(infoMessages).toHaveLength(0);
  });

  it('handles object-style integrations config with manual instrumentations', async () => {
    const { init, sdkInstances, autoInstrumentationsConfig, mockLogger } =
      await loadInitWithMocks();

    const manualMongoDBInstrumentation = new MongoDBInstrumentation({
      requireParentSpan: false,
    });

    init({
      service: 'test-app',
      integrations: {
        http: { enabled: true },
        mongodb: { enabled: true },
      },
      instrumentations: [manualMongoDBInstrumentation],
      logger: mockLogger,
    });

    // Check that auto-instrumentations were called with MongoDB disabled
    expect(autoInstrumentationsConfig).toHaveLength(1);
    const config = autoInstrumentationsConfig[0];
    expect(config['@opentelemetry/instrumentation-mongodb']).toEqual({
      enabled: false,
    });

    // Check that manual MongoDB instrumentation is in the final list
    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    const instrumentations = options.instrumentations as unknown[];
    expect(instrumentations).toContain(manualMongoDBInstrumentation);
  });

  it('works correctly when no conflicts exist', async () => {
    const { init, sdkInstances, mockLogger, logMessages } =
      await loadInitWithMocks();

    const manualHttpInstrumentation = new HttpInstrumentation({
      requireParentSpan: false,
    });

    init({
      service: 'test-app',
      integrations: ['mongodb', 'mongoose'],
      instrumentations: [manualHttpInstrumentation],
      logger: mockLogger,
    });

    // Check that manual instrumentation is in the final list
    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    const instrumentations = options.instrumentations as unknown[];
    expect(instrumentations).toContain(manualHttpInstrumentation);

    // Check that warning was logged (because manual HTTP provided with auto-integrations)
    const manualInstrumentationWarnings = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(manualInstrumentationWarnings).toHaveLength(1);
    expect(manualInstrumentationWarnings[0].message).toContain(
      'HttpInstrumentation',
    );
  });
});
