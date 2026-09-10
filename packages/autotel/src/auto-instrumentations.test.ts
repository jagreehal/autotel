import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetAutoInstrumentationsLoader,
  _setAutoInstrumentationsLoader,
  getAutoInstrumentations,
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

    it('defaults nothing for the other instrumentations', () => {
      const calls = captureConfig();

      getAutoInstrumentations(['http', 'pino']);

      expect(calls[0]).toEqual({
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-pino': { enabled: true },
        [EXPRESS]: { ignoreLayersType: ['middleware', 'request_handler'] },
      });
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
