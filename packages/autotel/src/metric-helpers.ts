import type {
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  UpDownCounter,
} from '@opentelemetry/api';
import { getConfig } from './config';

function getActiveMeter(): Meter {
  const config = getConfig();
  return config.meter;
}

export function getMeter(): Meter {
  return getActiveMeter();
}

type CounterOptions = Parameters<Meter['createCounter']>[1];
type HistogramOptions = Parameters<Meter['createHistogram']>[1];
type UpDownCounterOptions = Parameters<Meter['createUpDownCounter']>[1];
type ObservableGaugeOptions = Parameters<Meter['createObservableGauge']>[1];

export function createCounter(name: string, options?: CounterOptions): Counter {
  return getActiveMeter().createCounter(name, options);
}

export function createHistogram(
  name: string,
  options?: HistogramOptions,
): Histogram {
  return getActiveMeter().createHistogram(name, options);
}

export function createUpDownCounter(
  name: string,
  options?: UpDownCounterOptions,
): UpDownCounter {
  return getActiveMeter().createUpDownCounter(name, options);
}

export function createObservableGauge(
  name: string,
  options?: ObservableGaugeOptions,
): ObservableGauge {
  return getActiveMeter().createObservableGauge(name, options);
}
