import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetAutoInstrumentationsLoader,
  _setAutoInstrumentationsLoader,
  getAutoInstrumentations,
  isESMMode,
  isEsmHookLoaded,
  loggersLoadedBeforeInit,
  missingInstrumentations,
  REGISTER_FLAG,
  type InstrumentationSwitches,
} from './auto-instrumentations';

/**
 * Capture what `getNodeAutoInstrumentations` is handed. It keys off full
 * package names and `diag.error`s anything else, so the keys matter as much as
 * the values.
 */
function captureConfig() {
  const calls: InstrumentationSwitches[] = [];
  _setAutoInstrumentationsLoader(() => (config) => {
    calls.push(config ?? {});
    return [];
  });
  return calls;
}

afterEach(() => {
  _resetAutoInstrumentationsLoader();
});

describe('getAutoInstrumentations', () => {
  it('expands the short names in the array form', () => {
    const calls = captureConfig();

    getAutoInstrumentations(['mongodb', 'http']);

    expect(calls[0]).toMatchObject({
      '@opentelemetry/instrumentation-mongodb': { enabled: true },
      '@opentelemetry/instrumentation-http': { enabled: true },
    });
  });

  it('expands the short names in the object form and passes options through', () => {
    const calls = captureConfig();

    getAutoInstrumentations({
      express: { ignoreLayersType: ['middleware', 'request_handler'] },
      http: { enabled: false },
    });

    expect(calls[0]).toEqual({
      '@opentelemetry/instrumentation-express': {
        ignoreLayersType: ['middleware', 'request_handler'],
      },
      '@opentelemetry/instrumentation-http': { enabled: false },
    });
  });

  it('loads only the instrumentations the array lists', () => {
    const calls = captureConfig();

    getAutoInstrumentations(['pino'], new Set(), [4318]);

    expect(calls[0]?.['@opentelemetry/instrumentation-pino']).toEqual({
      enabled: true,
    });
    for (const name of ['http', 'dns', 'net', 'pg']) {
      expect(calls[0]?.[`@opentelemetry/instrumentation-${name}`]).toEqual({
        enabled: false,
      });
    }
  });

  it('leaves the object form loading everything it does not disable', () => {
    const calls = captureConfig();

    getAutoInstrumentations({ http: { enabled: false } });

    expect(calls[0]?.['@opentelemetry/instrumentation-dns']).toBeUndefined();
  });

  it('accepts a full package name in the object form unchanged', () => {
    const calls = captureConfig();

    getAutoInstrumentations({
      '@opentelemetry/instrumentation-mongodb': { requireParentSpan: true },
    });

    expect(calls[0]).toMatchObject({
      '@opentelemetry/instrumentation-mongodb': { requireParentSpan: true },
    });
  });

  // instrumentation-express runs every layer under a span of its own, and
  // whatever is active is where `ctx.setAttribute()` lands. Without this
  // default, request-wide attributes set from a middleware end up on a
  // `middleware - anonymous` span that ends the moment `next()` fires.
  describe('express layer spans', () => {
    const EXPRESS = '@opentelemetry/instrumentation-express';

    it('ignores middleware and request-handler layers by default', () => {
      const calls = captureConfig();

      getAutoInstrumentations(['express']);

      expect(calls[0]?.[EXPRESS]).toEqual({
        enabled: true,
        ignoreLayersType: ['middleware', 'request_handler'],
      });
    });

    it('applies the default when every instrumentation is enabled', () => {
      const calls = captureConfig();

      getAutoInstrumentations(true);

      expect(calls[0]?.[EXPRESS]).toEqual({
        ignoreLayersType: ['middleware', 'request_handler'],
      });
    });

    it('lets an explicit ignoreLayersType win, empty list included', () => {
      const calls = captureConfig();

      getAutoInstrumentations({ express: { ignoreLayersType: [] } });

      expect(calls[0]?.[EXPRESS]).toEqual({ ignoreLayersType: [] });
    });

    it('leaves a disabled express alone', () => {
      const calls = captureConfig();

      getAutoInstrumentations({ express: { enabled: false } });

      expect(calls[0]?.[EXPRESS]).toEqual({ enabled: false });
    });

    it('applies no default to an express the array leaves out', () => {
      const calls = captureConfig();

      getAutoInstrumentations(['http', 'pino']);

      expect(calls[0]?.[EXPRESS]).toEqual({ enabled: false });
    });

    it('adds no default for an express excluded by a manual instrumentation', () => {
      const calls = captureConfig();

      getAutoInstrumentations(true, new Set(['ExpressInstrumentation']));

      expect(calls[0]?.[EXPRESS]).toEqual({ enabled: false });
    });
  });

  it('keeps a manual instrumentation disabled even when the object form names it', () => {
    const calls = captureConfig();

    getAutoInstrumentations(
      { express: { ignoreLayersType: ['middleware'] } },
      new Set(['ExpressInstrumentation']),
    );

    expect(calls[0]).toEqual({
      '@opentelemetry/instrumentation-express': { enabled: false },
    });
  });
});

// The embedded devtools server shares the process; tracing its requests makes
// every OTLP export produce a span, a canonical log line, and another export.
describe('ignored server ports', () => {
  const HTTP = '@opentelemetry/instrumentation-http';
  const hookOf = (config: InstrumentationSwitches | undefined) =>
    config?.[HTTP]?.ignoreIncomingRequestHook as (req: unknown) => boolean;
  const onPort = (localPort: number) => ({ socket: { localPort } });

  it('ignores incoming requests on those ports', () => {
    const calls = captureConfig();

    getAutoInstrumentations(['pino', 'http'], new Set(), [4318]);

    const hook = hookOf(calls[0]);
    expect(hook(onPort(4318))).toBe(true);
    expect(hook(onPort(8400))).toBe(false);
  });

  it("keeps the caller's own hook", () => {
    const calls = captureConfig();

    getAutoInstrumentations(
      { http: { ignoreIncomingRequestHook: () => true } },
      new Set(),
      [4318],
    );

    expect(hookOf(calls[0])(onPort(8400))).toBe(true);
  });

  it('leaves a disabled http instrumentation alone', () => {
    const calls = captureConfig();

    getAutoInstrumentations({ http: { enabled: false } }, new Set(), [4318]);

    expect(calls[0]?.[HTTP]).toEqual({ enabled: false });
  });
});

// Instrumentations patch a logger as it loads, so one already loaded when
// init() runs never gets trace context.
describe('loggersLoadedBeforeInit', () => {
  const loaded = [
    '/app/node_modules/pino/pino.js',
    String.raw`C:\app\node_modules\winston\lib\winston.js`,
  ];

  it('reports requested loggers that are already loaded', () => {
    expect(loggersLoadedBeforeInit(['pino', 'winston'], loaded)).toEqual([
      'pino',
      'winston',
    ]);
  });

  it('ignores loggers that were not requested or not loaded', () => {
    expect(loggersLoadedBeforeInit(['http', 'bunyan'], loaded)).toEqual([]);
    expect(loggersLoadedBeforeInit(false, loaded)).toEqual([]);
  });

  it('reads the object form and full package names', () => {
    expect(
      loggersLoadedBeforeInit(
        {
          '@opentelemetry/instrumentation-pino': {},
          winston: { enabled: false },
        },
        loaded,
      ),
    ).toEqual(['pino']);
  });

  it('treats true as every logger', () => {
    expect(loggersLoadedBeforeInit(true, loaded)).toEqual(['pino', 'winston']);
  });
});

describe('isEsmHookLoaded', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[REGISTER_FLAG];
  });

  it('is false with no register import and no hook flag', () => {
    expect(isEsmHookLoaded('--import tsx')).toBe(false);
  });

  it('sees autotel/register', () => {
    (globalThis as Record<symbol, unknown>)[REGISTER_FLAG] = true;
    expect(isEsmHookLoaded('')).toBe(true);
  });

  it('sees a hook.mjs passed to node directly', () => {
    expect(isEsmHookLoaded('--experimental-loader=autotel/hook.mjs')).toBe(
      true,
    );
  });
});

describe('missingInstrumentations', () => {
  const loaded = [
    { instrumentationName: '@opentelemetry/instrumentation-http' },
    { instrumentationName: '@opentelemetry/instrumentation-pino' },
  ];

  it('names what the array asked for and did not load', () => {
    expect(
      missingInstrumentations(['http', 'pino', 'fastify'], loaded),
    ).toEqual(['fastify']);
  });

  it('does not count a library a manual instrumentation replaced', () => {
    expect(
      missingInstrumentations(
        ['http', 'express'],
        loaded,
        new Set(['ExpressInstrumentation']),
      ),
    ).toEqual([]);
  });
});

describe('isESMMode', () => {
  it('trusts an explicit entry extension over package.json', () => {
    // packages/autotel's package.json is "type": "module".
    expect(isESMMode('/app/server.cjs')).toBe(false);
    expect(isESMMode('/app/server.cts')).toBe(false);
    expect(isESMMode('/app/server.mjs')).toBe(true);
    expect(isESMMode('/app/server.js')).toBe(true);
  });
});
