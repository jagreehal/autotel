import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configure, getConfig, resetConfig } from './config';

describe('configure()', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('should set custom tracer name', () => {
    configure({
      tracerName: 'my-custom-tracer',
    });

    const config = getConfig();
    expect(config.tracerName).toBe('my-custom-tracer');
  });

  it('should set custom meter name', () => {
    configure({
      meterName: 'my-custom-meter',
    });

    const config = getConfig();
    expect(config.meterName).toBe('my-custom-meter');
  });

  it('should allow custom tracer instance', () => {
    const mockTracer = {
      startActiveSpan: vi.fn(),
      startSpan: vi.fn(),
    };

    configure({
      tracer: mockTracer as any,
    });

    const config = getConfig();
    expect(config.tracer).toBe(mockTracer);
  });

  it('should allow custom meter instance', () => {
    const mockMeter = {
      createCounter: vi.fn(),
      createHistogram: vi.fn(),
      createUpDownCounter: vi.fn(),
      createObservableGauge: vi.fn(),
      createObservableCounter: vi.fn(),
      createObservableUpDownCounter: vi.fn(),
    };

    configure({
      meter: mockMeter as any,
    });

    const config = getConfig();
    expect(config.meter).toBe(mockMeter);
  });

  it('should merge configurations', () => {
    configure({
      tracerName: 'tracer-1',
    });

    configure({
      meterName: 'meter-1',
    });

    const config = getConfig();
    expect(config.tracerName).toBe('tracer-1');
    expect(config.meterName).toBe('meter-1');
  });

  it('should reset to defaults', () => {
    configure({
      tracerName: 'custom-tracer',
      meterName: 'custom-meter',
    });

    resetConfig();

    const config = getConfig();
    expect(config.tracerName).toBe('app');
    expect(config.meterName).toBe('app');
  });

  it('should expose feature flags', () => {
    const config = getConfig();
    expect(config.featureFlags).toBeDefined();
    expect(typeof config.featureFlags.ENABLE_TRACING).toBe('boolean');
    expect(typeof config.featureFlags.ENABLE_METRICS_BY_DEFAULT).toBe(
      'boolean',
    );
  });
});
