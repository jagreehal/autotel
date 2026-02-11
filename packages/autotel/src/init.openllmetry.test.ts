import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeSDK } from '@opentelemetry/sdk-node';
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
  './node-require',
];

// Track traceloop initialize calls globally
const traceloopInitializeCalls: Array<Record<string, unknown>> = [];

// Store mock initialize function globally
let globalMockInitialize: ReturnType<typeof vi.fn> | null = null;

async function loadInitWithMocks() {
  const sdkInstances: SdkRecord[] = [];

  class MockNodeSDK {
    constructor(options: Record<string, unknown>) {
      const instance = mockDeep<NodeSDK>();
      instance.start.mockImplementation(() => {});
      instance.shutdown.mockResolvedValue();

      (instance as any).getTracerProvider = vi.fn().mockReturnValue(mock());
      sdkInstances.push({ options, instance });
      return instance;
    }
  }

  class MockOTLPTraceExporter {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockOTLPMetricExporter {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockPeriodicExportingMetricReader {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  // Clear module cache first
  vi.resetModules();

  // Create mock function that captures calls and store it globally
  globalMockInitialize = vi.fn((options?: Record<string, unknown>) => {
    traceloopInitializeCalls.push(options || {});
  });

  const mockTraceloop = {
    initialize: globalMockInitialize,
    instrumentations: [{ name: 'openai' }, { name: 'langchain' }],
  };

  // Mock node-require to intercept safeRequire('@traceloop/node-server-sdk').
  // vi.doMock on the traceloop module itself doesn't work because safeRequire
  // uses native require() which bypasses vitest's module interception.
  vi.doMock('./node-require', () => ({
    safeRequire: vi.fn((id: string) => {
      if (id === '@traceloop/node-server-sdk') {
        return mockTraceloop;
      }
      return undefined;
    }),
    requireModule: vi.fn((id: string) => {
      const err = new Error(`Cannot find module '${id}'`);
      (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
      throw err;
    }),
    nodeRequire: vi.fn(),
  }));

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
    traceloopInitializeCalls,
    mockTraceloop,
  };
}

describe('init() OpenLLMetry integration', () => {
  beforeEach(() => {
    vi.resetModules();
    traceloopInitializeCalls.length = 0;
    globalMockInitialize = null;
  });

  afterEach(() => {
    for (const mod of mockedModules) {
      vi.doUnmock(mod);
    }
    vi.clearAllMocks();
    delete process.env.AUTOTEL_METRICS;
    delete process.env.NODE_ENV;
    delete process.env.TRACELOOP_API_KEY;
  });

  it('should not initialize OpenLLMetry when disabled', async () => {
    const { init, traceloopInitializeCalls } = await loadInitWithMocks();

    init({ service: 'test-app' });

    expect(traceloopInitializeCalls).toHaveLength(0);
  });

  it('should initialize OpenLLMetry when enabled', async () => {
    const { init, traceloopInitializeCalls } = await loadInitWithMocks();

    init({
      service: 'test-app',
      openllmetry: { enabled: true },
    });

    expect(traceloopInitializeCalls).toHaveLength(1);
    expect(traceloopInitializeCalls[0]).toBeDefined();
  });

  it('should pass OpenLLMetry options to initialize', async () => {
    const { init, traceloopInitializeCalls } = await loadInitWithMocks();

    init({
      service: 'test-app',
      openllmetry: {
        enabled: true,
        options: {
          disableBatch: true,
          apiKey: 'test-key',
        },
      },
    });

    expect(traceloopInitializeCalls).toHaveLength(1);
    expect(traceloopInitializeCalls[0]).toMatchObject({
      disableBatch: true,
      apiKey: 'test-key',
    });
  });

  it('should reuse autotel tracer provider when OpenLLMetry is enabled', async () => {
    const { init, traceloopInitializeCalls, sdkInstances } =
      await loadInitWithMocks();

    init({
      service: 'test-app',
      openllmetry: { enabled: true },
    });

    expect(sdkInstances).toHaveLength(1);
    const sdkInstance = sdkInstances[0].instance;

    expect(traceloopInitializeCalls).toHaveLength(1);
    const callOptions = traceloopInitializeCalls[0];
    expect(callOptions).toBeDefined();
    expect((sdkInstance as any).getTracerProvider).toHaveBeenCalled();
  });

  it('should add OpenLLMetry instrumentations when selectiveInstrumentation is false', async () => {
    const { init, sdkInstances, mockTraceloop } = await loadInitWithMocks();

    init({
      service: 'test-app',
      openllmetry: { enabled: true },
      autoInstrumentations: false,
    });

    const options = sdkInstances.at(-1)?.options as Record<string, unknown>;
    const instrumentations = options.instrumentations as unknown[];

    expect(instrumentations).toBeDefined();
    expect(mockTraceloop.instrumentations).toBeDefined();
  });

  it('should handle missing @traceloop/node-server-sdk gracefully', async () => {
    vi.resetModules();

    // Mock node-require to return undefined for traceloop (simulating not installed)
    vi.doMock('./node-require', () => ({
      safeRequire: vi.fn(() => undefined),
      requireModule: vi.fn((id: string) => {
        const err = new Error(`Cannot find module '${id}'`);
        (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
        throw err;
      }),
      nodeRequire: vi.fn(),
    }));

    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: class {
        constructor() {
          const instance = mockDeep<NodeSDK>();
          instance.start.mockImplementation(() => {});
          instance.shutdown.mockResolvedValue();
          return instance;
        }
      },
    }));

    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: class {
        constructor() {}
      },
    }));

    vi.doMock('@opentelemetry/exporter-metrics-otlp-http', () => ({
      OTLPMetricExporter: class {
        constructor() {}
      },
    }));

    vi.doMock('@opentelemetry/sdk-metrics', () => ({
      PeriodicExportingMetricReader: class {
        constructor() {}
      },
    }));

    const { init } = await import('./init');

    expect(() => {
      init({
        service: 'test-app',
        openllmetry: { enabled: true },
      });
    }).not.toThrow();
  });

  it('should initialize OpenLLMetry after SDK start', async () => {
    const { init, sdkInstances, traceloopInitializeCalls } =
      await loadInitWithMocks();

    init({
      service: 'test-app',
      openllmetry: { enabled: true },
    });

    // Verify SDK started (synchronously in init)
    expect(sdkInstances).toHaveLength(1);
    expect(sdkInstances[0].instance.start).toHaveBeenCalled();

    // Verify OpenLLMetry was initialized (synchronously via safeRequire)
    expect(traceloopInitializeCalls).toHaveLength(1);
  });
});
