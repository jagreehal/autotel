import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { sdkDouble } from './testing/doubles';
import type { UnknownRecord } from './values';

type InitModule = typeof import('./init');

/** What init() hands its sdkFactory - the NodeSDK options it assembled. */
type SdkOptions = Partial<NodeSDKConfiguration>;

/** The parts of the Traceloop SDK that init() reaches for. */
interface TraceloopModule {
  initialize?: (options?: UnknownRecord) => void;
  instrumentations?: readonly { name: string }[];
}

async function loadInitModule(): Promise<InitModule> {
  vi.resetModules();
  // resetModules clears the registry, so ./init must be re-imported here to
  // get a fresh instance; a static import would return the stale module.
  // eslint-disable-next-line no-restricted-syntax
  return import('./init');
}

// safeRequire is generic (<T>(id) => T | undefined); a fixed stub module can't
// be generic, so adapt it to the loader shape (returns the stub for any id).
type OptionalRequire = Parameters<
  InitModule['_setOptionalRequireForTesting']
>[0];
function stubRequire(module: TraceloopModule): OptionalRequire {
  // SAFETY: safeRequire is generic in what the module id resolves to; a fixed
  // stub cannot be. The loader hands back this one module for any id, which is
  // all any test here asks of it.
  return (() => module) as OptionalRequire;
}

/**
 * Traceloop installed as the module init() will find, with the options each
 * initialize() call received.
 */
function installTraceloop(mod: InitModule): UnknownRecord[] {
  const initializeCalls: UnknownRecord[] = [];
  mod._setOptionalRequireForTesting(
    stubRequire({
      initialize: (options?: UnknownRecord) =>
        initializeCalls.push(options ?? {}),
    }),
  );
  return initializeCalls;
}

function createSdkFactory() {
  const calls: SdkOptions[] = [];
  const getTracerProvider = vi.fn(() => ({ id: 'mock-tracer-provider' }));
  const start = vi.fn();
  const shutdown = vi.fn(async () => {});

  return {
    calls,
    getTracerProvider,
    start,
    shutdown,
    sdkFactory: (options: SdkOptions) => {
      calls.push(options);
      return sdkDouble({ start, shutdown, getTracerProvider });
    },
  };
}

describe('init() OpenLLMetry integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTOTEL_METRICS;
    delete process.env.NODE_ENV;
    delete process.env.TRACELOOP_API_KEY;
  });

  it('should not initialize OpenLLMetry when disabled', async () => {
    const mod = await loadInitModule();
    const sdk = createSdkFactory();
    const traceloopInitializeCalls = installTraceloop(mod);

    mod.init({ service: 'test-app', sdkFactory: sdk.sdkFactory });

    expect(traceloopInitializeCalls).toHaveLength(0);
    mod._resetOptionalRequireForTesting();
  });

  it('should initialize OpenLLMetry when enabled', async () => {
    const mod = await loadInitModule();
    const sdk = createSdkFactory();
    const traceloopInitializeCalls = installTraceloop(mod);

    mod.init({
      service: 'test-app',
      openllmetry: { enabled: true },
      sdkFactory: sdk.sdkFactory,
    });

    expect(traceloopInitializeCalls).toHaveLength(1);
    expect(traceloopInitializeCalls[0]).toBeDefined();
    mod._resetOptionalRequireForTesting();
  });

  it('should pass OpenLLMetry options to initialize', async () => {
    const mod = await loadInitModule();
    const sdk = createSdkFactory();
    const traceloopInitializeCalls = installTraceloop(mod);

    mod.init({
      service: 'test-app',
      openllmetry: {
        enabled: true,
        options: {
          disableBatch: true,
          apiKey: 'test-key',
        },
      },
      sdkFactory: sdk.sdkFactory,
    });

    expect(traceloopInitializeCalls).toHaveLength(1);
    expect(traceloopInitializeCalls[0]).toMatchObject({
      disableBatch: true,
      apiKey: 'test-key',
    });
    mod._resetOptionalRequireForTesting();
  });

  it('should reuse autotel tracer provider when OpenLLMetry is enabled', async () => {
    const mod = await loadInitModule();
    const sdk = createSdkFactory();
    const traceloopInitializeCalls = installTraceloop(mod);

    mod.init({
      service: 'test-app',
      openllmetry: { enabled: true },
      sdkFactory: sdk.sdkFactory,
    });

    expect(traceloopInitializeCalls).toHaveLength(1);
    const callOptions = traceloopInitializeCalls[0];
    expect(callOptions).toBeDefined();
    expect(sdk.getTracerProvider).toHaveBeenCalled();
    mod._resetOptionalRequireForTesting();
  });

  it('should add OpenLLMetry instrumentations when selectiveInstrumentation is false', async () => {
    const mod = await loadInitModule();
    const sdk = createSdkFactory();
    const mockTraceloop = {
      initialize: vi.fn(),
      instrumentations: [{ name: 'openai' }, { name: 'langchain' }],
    };

    mod._setOptionalRequireForTesting(stubRequire(mockTraceloop));

    mod.init({
      service: 'test-app',
      openllmetry: { enabled: true },
      autoInstrumentations: false,
      sdkFactory: sdk.sdkFactory,
    });

    expect(sdk.calls.at(-1)?.instrumentations).toBeDefined();
    expect(mockTraceloop.instrumentations).toBeDefined();
    mod._resetOptionalRequireForTesting();
  });

  it('should handle missing @traceloop/node-server-sdk gracefully', async () => {
    const mod = await loadInitModule();
    const sdk = createSdkFactory();
    mod._setOptionalRequireForTesting(() => {});

    expect(() => {
      mod.init({
        service: 'test-app',
        openllmetry: { enabled: true },
        sdkFactory: sdk.sdkFactory,
      });
    }).not.toThrow();
    mod._resetOptionalRequireForTesting();
  });

  it('should initialize OpenLLMetry after SDK start', async () => {
    const mod = await loadInitModule();
    const sdk = createSdkFactory();
    const traceloopInitializeCalls = installTraceloop(mod);

    mod.init({
      service: 'test-app',
      openllmetry: { enabled: true },
      sdkFactory: sdk.sdkFactory,
    });

    // Verify SDK started (synchronously in init)
    expect(sdk.calls).toHaveLength(1);
    expect(sdk.start).toHaveBeenCalled();

    // Verify OpenLLMetry was initialized (synchronously via safeRequire)
    expect(traceloopInitializeCalls).toHaveLength(1);
    mod._resetOptionalRequireForTesting();
  });
});
