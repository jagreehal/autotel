import { describe, it, expect, beforeEach, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { configure, getConfig, resetConfig } from './config';
import { tracerDouble } from './testing/doubles.js';

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
      tracer: tracerDouble(mockTracer),
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

  it('should resolve the meter registered after this module was imported', async () => {
    // This module is imported before init() registers a MeterProvider, so the
    // meter captured at construction is a no-op. Anything reading
    // getConfig().meter must see the real provider once it exists.
    const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter })],
    });
    metrics.setGlobalMeterProvider(provider);

    try {
      getConfig().meter.createCounter('probe').add(1);
      await provider.forceFlush();

      const names = exporter
        .getMetrics()
        .flatMap((resourceMetric) => resourceMetric.scopeMetrics)
        .flatMap((scopeMetric) => scopeMetric.metrics)
        .map((metric) => metric.descriptor.name);
      expect(names).toContain('probe');
    } finally {
      await provider.shutdown();
      metrics.disable();
    }
  });

  it('should expose feature flags', () => {
    const config = getConfig();
    expect(config.featureFlags).toBeDefined();
    expect(config.featureFlags.ENABLE_TRACING).toBeTypeOf('boolean');
    expect(typeof config.featureFlags.ENABLE_METRICS_BY_DEFAULT).toBe(
      'boolean',
    );
  });
});
