import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AggregationTemporality,
  InstrumentType,
  type IMetricReader,
} from '@opentelemetry/sdk-metrics';
import { init } from './init';
import { shutdown } from './shutdown';
import { sdkDouble } from './testing/doubles';

const ENV = 'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE';

/** The temporality init()'s metric reader picks for a counter. */
function counterTemporality(endpoint: string): AggregationTemporality {
  let readers: IMetricReader[] = [];
  init({
    service: 'temporality',
    endpoint,
    metrics: true,
    sdkFactory: (options) => {
      readers = options.metricReaders ?? [];
      return sdkDouble({
        start: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
        getTracerProvider: () => {},
      });
    },
  });
  const [reader] = readers;
  if (!reader || readers.length !== 1) throw new Error('expected one reader');
  return reader.selectAggregationTemporality(InstrumentType.COUNTER);
}

describe('metric temporality', () => {
  afterEach(async () => {
    delete process.env[ENV];
    await shutdown();
  });

  it('exports delta to Datadog direct intake, which drops cumulative', () => {
    expect(counterTemporality('https://otlp.datadoghq.eu')).toBe(
      AggregationTemporality.DELTA,
    );
    expect(counterTemporality('https://otlp.us5.datadoghq.com')).toBe(
      AggregationTemporality.DELTA,
    );
  });

  it('keeps the SDK default elsewhere, the Datadog Agent included', () => {
    expect(counterTemporality('http://localhost:4318')).toBe(
      AggregationTemporality.CUMULATIVE,
    );
  });

  it('lets the env var override it', () => {
    process.env[ENV] = 'cumulative';
    expect(counterTemporality('https://otlp.datadoghq.eu')).toBe(
      AggregationTemporality.CUMULATIVE,
    );
  });
});
