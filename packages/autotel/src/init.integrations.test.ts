import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trace, context, propagation } from '@opentelemetry/api';
import type { NodeSDK, NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep } from 'vitest-mock-extended';
import {
  _setAutoInstrumentationsLoader,
  _resetAutoInstrumentationsLoader,
  type InstrumentationSwitches,
} from './init';
import type {
  Instrumentation,
  InstrumentationConfig,
} from '@opentelemetry/instrumentation';
import type { MeterProvider, TracerProvider } from '@opentelemetry/api';
import type { LoggerProvider } from '@opentelemetry/api-logs';
import type { UnknownRecord } from './values';

/** Pino's own field bag: what LogFn takes, mirrored by this fake logger. */
type LogFields = UnknownRecord;

/** The options a constructor was called with, as this harness records them. */
type SdkOptions = Partial<NodeSDKConfiguration>;

/** What an exporter or instrumentation was constructed with. */
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
  options: RecordedOptions;
  instance: DeepMockProxy<NodeSDK>;
};

const mockedModules = [
  '@opentelemetry/sdk-node',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/sdk-metrics',
];

// Mock instrumentation classes with exact names from OpenTelemetry.
// NodeSDK.start() calls lifecycle hooks on each instrumentation instance.
class MockInstrumentationBase implements Instrumentation {
  instrumentationName = 'mock-instrumentation';
  instrumentationVersion = '1.0.0';
  config: InstrumentationConfig;

  constructor(config: InstrumentationConfig & RecordedOptions = {}) {
    this.config = config;
  }

  setConfig(config: InstrumentationConfig) {
    this.config = config;
  }
  getConfig(): InstrumentationConfig {
    return this.config;
  }
  setTracerProvider(_provider: TracerProvider) {}
  setMeterProvider(_provider: MeterProvider) {}
  setLoggerProvider(_provider: LoggerProvider) {}
  enable() {}
  disable() {}
}

class MongoDBInstrumentation extends MockInstrumentationBase {}

class MongooseInstrumentation extends MockInstrumentationBase {}

class HttpInstrumentation extends MockInstrumentationBase {}

async function loadInitWithMocks() {
  const sdkInstances: SdkRecord[] = [];
  const traceExporterOptions: RecordedOptions[] = [];
  const metricExporterOptions: RecordedOptions[] = [];
  const autoInstrumentationsConfig: InstrumentationSwitches[] = [];
  const logMessages: {
    level: string;
    message: string;
  }[] = [];

  class MockNodeSDK {
    constructor(options: RecordedOptions) {
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
    constructor(public options: RecordedOptions) {}
  }

  // Mock getNodeAutoInstrumentations function
  const mockGetNodeAutoInstrumentations = vi.fn(
    (config?: InstrumentationSwitches) => {
      if (config) {
        autoInstrumentationsConfig.push(config);
      }

      // Simulate returning auto-instrumentations based on config
      const instrumentations: NodeSDKConfiguration['instrumentations'] = [];

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

  // Mock logger to capture log messages (Pino-compatible signature: extra, message)
  const mockLogger = {
    info: vi.fn((extra: LogFields | string, msg?: string) => {
      logMessages.push({ level: 'info', message: msg || '' });
    }),
    warn: vi.fn((extra: LogFields | string, msg?: string) => {
      logMessages.push({ level: 'warn', message: msg || '' });
    }),
    error: vi.fn((extra: LogFields | string, msg?: string) => {
      logMessages.push({ level: 'error', message: msg || '' });
    }),
    debug: vi.fn((extra: LogFields | string, msg?: string) => {
      logMessages.push({ level: 'debug', message: msg || '' });
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

  // vi.doMock is not hoisted, so ./init must be imported after the mocks
  // above are registered; a static import would bind the unmocked module.
  // eslint-disable-next-line no-restricted-syntax
  const initModule = await import('./init');

  // Inject the mock loader via the exported setter
  initModule._setAutoInstrumentationsLoader(
    () => mockGetNodeAutoInstrumentations,
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

  afterEach(async () => {
    for (const mod of mockedModules) {
      vi.doUnmock(mod);
    }
    vi.clearAllMocks();
    _resetAutoInstrumentationsLoader();
    delete process.env.AUTOTEL_METRICS;
    // Reset global OTel state that can leak between forked test files
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it('excludes manual instrumentations from auto-instrumentations when autoInstrumentations: true', async () => {
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
      autoInstrumentations: true,
      instrumentations: [
        manualMongoDBInstrumentation,
        manualMongooseInstrumentation,
      ],
      logger: mockLogger,
    });

    // Check that auto-instrumentations were called with exclusion config
    expect(autoInstrumentationsConfig).toHaveLength(1);
    const config = autoInstrumentationsConfig[0]!;
    expect(config['@opentelemetry/instrumentation-mongodb']).toEqual({
      enabled: false,
    });
    expect(config['@opentelemetry/instrumentation-mongoose']).toEqual({
      enabled: false,
    });

    // Check that manual instrumentations are in the final list
    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: init() passes the instrumentations it resolved; the assertions
    // below are about which ones ended up in that list.
    const instrumentations = options.instrumentations as unknown[];
    expect(instrumentations).toContain(manualMongoDBInstrumentation);
    expect(instrumentations).toContain(manualMongooseInstrumentation);

    // Check that warning was logged about detected manual instrumentations
    const manualInstrumentationWarnings = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(manualInstrumentationWarnings).toHaveLength(1);
    expect(manualInstrumentationWarnings[0]!.message).toContain(
      'Detected manual instrumentations',
    );
    expect(manualInstrumentationWarnings[0]!.message).toContain(
      'MongoDBInstrumentation',
    );
    expect(manualInstrumentationWarnings[0]!.message).toContain(
      'MongooseInstrumentation',
    );
  });

  it('excludes manual instrumentations from specific autoInstrumentations list', async () => {
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
      autoInstrumentations: ['http', 'mongodb'],
      instrumentations: [manualMongoDBInstrumentation],
      logger: mockLogger,
    });

    // Check that auto-instrumentations were called with MongoDB disabled
    expect(autoInstrumentationsConfig).toHaveLength(1);
    const config = autoInstrumentationsConfig[0]!;
    expect(config['@opentelemetry/instrumentation-mongodb']).toEqual({
      enabled: false,
    });
    expect(config['@opentelemetry/instrumentation-http']).toEqual({
      enabled: true,
    });

    // Check that manual MongoDB instrumentation is in the final list
    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: init() passes the instrumentations it resolved; the assertions
    // below are about which ones ended up in that list.
    const instrumentations = options.instrumentations as unknown[];
    expect(instrumentations).toContain(manualMongoDBInstrumentation);

    // Check that warning was logged about detected manual instrumentations
    const manualInstrumentationWarnings = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(manualInstrumentationWarnings).toHaveLength(1);
    expect(manualInstrumentationWarnings[0]!.message).toContain(
      'MongoDBInstrumentation',
    );
  });

  it('does not log warning when no manual instrumentations provided', async () => {
    const { init, mockLogger, logMessages } = await loadInitWithMocks();

    init({
      service: 'test-app',
      autoInstrumentations: true,
      logger: mockLogger,
    });

    // Check that no warning was logged
    const infoMessages = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(infoMessages).toHaveLength(0);
  });

  it('does not log warning when autoInstrumentations is false', async () => {
    const { init, mockLogger, logMessages } = await loadInitWithMocks();

    const manualMongoDBInstrumentation = new MongoDBInstrumentation({
      requireParentSpan: false,
    });

    init({
      service: 'test-app',
      autoInstrumentations: false,
      instrumentations: [manualMongoDBInstrumentation],
      logger: mockLogger,
    });

    // Check that no warning was logged
    const infoMessages = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(infoMessages).toHaveLength(0);
  });

  it('handles object-style autoInstrumentations config with manual instrumentations', async () => {
    const { init, sdkInstances, autoInstrumentationsConfig, mockLogger } =
      await loadInitWithMocks();

    const manualMongoDBInstrumentation = new MongoDBInstrumentation({
      requireParentSpan: false,
    });

    init({
      service: 'test-app',
      autoInstrumentations: {
        http: { enabled: true },
        mongodb: { enabled: true },
      },
      instrumentations: [manualMongoDBInstrumentation],
      logger: mockLogger,
    });

    // Check that auto-instrumentations were called with MongoDB disabled
    expect(autoInstrumentationsConfig).toHaveLength(1);
    const config = autoInstrumentationsConfig[0]!;
    expect(config['@opentelemetry/instrumentation-mongodb']).toEqual({
      enabled: false,
    });

    // Check that manual MongoDB instrumentation is in the final list
    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: init() passes the instrumentations it resolved; the assertions
    // below are about which ones ended up in that list.
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
      autoInstrumentations: ['mongodb', 'mongoose'],
      instrumentations: [manualHttpInstrumentation],
      logger: mockLogger,
    });

    // Check that manual instrumentation is in the final list
    // init() constructs exactly one SDK, so the last record is this run's.
    const options = sdkInstances.at(-1)!.options;
    // SAFETY: init() passes the instrumentations it resolved; the assertions
    // below are about which ones ended up in that list.
    const instrumentations = options.instrumentations as unknown[];
    expect(instrumentations).toContain(manualHttpInstrumentation);

    // Check that warning was logged (because manual HTTP provided with auto-integrations)
    const manualInstrumentationWarnings = logMessages.filter(
      (log) => log.level === 'info' && log.message.includes('Detected manual'),
    );
    expect(manualInstrumentationWarnings).toHaveLength(1);
    expect(manualInstrumentationWarnings[0]!.message).toContain(
      'HttpInstrumentation',
    );
  });
});
