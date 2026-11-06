import { ROOT_CONTEXT, trace, TraceFlags, logs } from '@opentelemetry/api';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  type DataPoint,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  TracerProvider,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, resetConfig } from './config';
import { init } from './init';
import { shutdown } from './shutdown';
import { sdkDouble } from './testing/doubles';
import {
  STATE_TRANSITION_EVENT,
  STATE_TRANSITIONS_METRIC,
  transition,
} from './transition';

const PAID = {
  entity: 'order',
  field: 'status',
  from: 'pending',
  to: 'paid',
  via: 'checkout',
};

const ATTRIBUTES = {
  'state.entity': 'order',
  'state.field': 'status',
  'state.from': 'pending',
  'state.to': 'paid',
  'state.via': 'checkout',
};

describe('transition', () => {
  let exporter: InMemoryMetricExporter;
  let reader: PeriodicExportingMetricReader;
  let meterProvider: MeterProvider;
  let logExporter: InMemoryLogRecordExporter;
  let loggerProvider: LoggerProvider;

  /** Every data point of the transitions counter collected so far. */
  async function dataPoints() {
    await reader.forceFlush();
    return (
      exporter
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => {
          return metric.descriptor.name === STATE_TRANSITIONS_METRIC;
        })
        // SAFETY: the transitions counter is a sum, so its points hold numbers.
        .flatMap((metric) => metric.dataPoints as DataPoint<number>[])
    );
  }

  /** Every log record emitted so far. The processor exports asynchronously. */
  async function logRecords() {
    await loggerProvider.forceFlush();
    return logExporter.getFinishedLogRecords();
  }

  function activeSpan(sampled: boolean) {
    const provider = new TracerProvider({
      sampler: sampled ? new AlwaysOnSampler() : new AlwaysOffSampler(),
    });
    const span = provider.getTracer('test').startSpan('save', {}, ROOT_CONTEXT);
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
    return span;
  }

  beforeEach(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    meterProvider = new MeterProvider({ readers: [reader] });
    configure({ meter: meterProvider.getMeter('test') });

    logExporter = new InMemoryLogRecordExporter();
    loggerProvider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
    });
    logs.disable();
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetConfig();
    logs.disable();
    await meterProvider.shutdown();
  });

  it('counts a transition under its state attributes', async () => {
    transition(PAID);
    transition(PAID);

    const [point, ...rest] = await dataPoints();
    expect(rest).toHaveLength(0);
    expect(point?.value).toBe(2);
    expect(point?.attributes).toEqual(ATTRIBUTES);
  });

  it('defaults via to unknown', async () => {
    transition({ entity: 'order', field: 'status', from: 'a', to: 'b' });

    const [point] = await dataPoints();
    expect(point?.attributes['state.via']).toBe('unknown');
  });

  it('never puts the id on the metric', async () => {
    transition({ ...PAID, id: 'order-1' });
    transition({ ...PAID, id: 'order-2', history: true });

    const points = await dataPoints();
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(2);
    expect(points[0]?.attributes).toEqual(ATTRIBUTES);
    expect(JSON.stringify(points)).not.toContain('order-1');
    expect(JSON.stringify(points)).not.toContain('order-2');
  });

  it('counts with no span active', async () => {
    expect(trace.getActiveSpan()).toBeUndefined();
    transition(PAID);

    const [point] = await dataPoints();
    expect(point?.value).toBe(1);
  });

  it('counts when the trace is unsampled, and adds no event', async () => {
    const span = activeSpan(false);
    const addEvent = vi.spyOn(span, 'addEvent');
    expect(span.spanContext().traceFlags).toBe(TraceFlags.NONE);

    transition(PAID);

    const [point] = await dataPoints();
    expect(point?.value).toBe(1);
    expect(addEvent).not.toHaveBeenCalled();
  });

  it('adds a span event to a recording span, without the id', () => {
    const span = activeSpan(true);
    transition({ ...PAID, id: 'order-1' });
    span.end();

    // SAFETY: AlwaysOnSampler produced an SDK span, which is a ReadableSpan.
    const [event] = (span as unknown as ReadableSpan).events;
    expect(event?.name).toBe(STATE_TRANSITION_EVENT);
    expect(event?.attributes).toEqual(ATTRIBUTES);
  });

  it('puts the id on the span event only with history', () => {
    const span = activeSpan(true);
    transition({ ...PAID, id: 'order-1', history: true });
    span.end();

    // SAFETY: AlwaysOnSampler produced an SDK span, which is a ReadableSpan.
    const [event] = (span as unknown as ReadableSpan).events;
    expect(event?.attributes).toEqual({
      ...ATTRIBUTES,
      'state.id': 'order-1',
    });
  });

  it('emits a log record with history and an id', async () => {
    transition({ ...PAID, id: 'order-1', history: true });

    const [record, ...rest] = await logRecords();
    expect(rest).toHaveLength(0);
    expect(record?.eventName).toBe(STATE_TRANSITION_EVENT);
    expect(record?.body).toBe(STATE_TRANSITION_EVENT);
    expect(record?.attributes).toEqual({
      ...ATTRIBUTES,
      'state.id': 'order-1',
    });
  });

  it('emits the log record when the trace is unsampled', async () => {
    activeSpan(false);
    transition({ ...PAID, id: 'order-1', history: true });

    expect(await logRecords()).toHaveLength(1);
  });

  it('emits no log record by default, or without an id', async () => {
    transition({ ...PAID, id: 'order-1' });
    transition({ ...PAID, history: true });

    expect(await logRecords()).toHaveLength(0);
  });

  it('uses the meter current at the call, not the first one seen', async () => {
    const earlier = new MeterProvider();
    configure({ meter: earlier.getMeter('earlier') });
    transition(PAID);

    configure({ meter: meterProvider.getMeter('test') });
    transition(PAID);

    const [point] = await dataPoints();
    expect(point?.value).toBe(1);
    await earlier.shutdown();
  });

  it('never throws, and one failed signal leaves the others', async () => {
    const counterFailure = {
      createCounter: () => {
        throw new Error('meter down');
      },
    };
    // SAFETY: transition() only calls createCounter on the meter.
    configure({ meter: counterFailure as never });
    const span = activeSpan(true);
    const addEvent = vi.spyOn(span, 'addEvent').mockImplementation(() => {
      throw new Error('span down');
    });

    expect(() =>
      transition({ ...PAID, id: 'order-1', history: true }),
    ).not.toThrow();
    expect(addEvent).toHaveBeenCalledOnce();
    expect(await logRecords()).toHaveLength(1);
  });

  it.each([
    ['nothing', undefined],
    ['a missing state', { entity: 'order', field: 'status', to: 'paid' }],
    ['an empty state', { ...PAID, from: '' }],
  ])('records nothing and does not throw for %s', async (_, input) => {
    // SAFETY: this is the untyped caller the guard exists for.
    expect(() => transition(input as never)).not.toThrow();
    expect(await dataPoints()).toHaveLength(0);
  });

  describe('subscribers', () => {
    afterEach(async () => {
      await shutdown();
    });

    function initWith(subscribers: unknown[]) {
      const warn = vi.fn();
      init({
        service: 'orders',
        // SAFETY: the double only needs the logger methods track() reaches.
        logger: {
          info: vi.fn(),
          warn,
          error: vi.fn(),
          debug: vi.fn(),
        } as never,
        // SAFETY: this is the configured-subscribers path, not their delivery.
        subscribers: subscribers as never,
        sdkFactory: () =>
          sdkDouble({
            start: vi.fn(),
            shutdown: vi.fn().mockResolvedValue(undefined),
            getTracerProvider: () => {},
          }),
      });
      return warn;
    }

    it('reaches a subscriber through track, without the id', async () => {
      const trackEvent = vi.fn().mockResolvedValue(undefined);
      initWith([{ name: 'test', trackEvent }]);

      transition({ ...PAID, id: 'order-1', history: true });
      await shutdown();

      expect(trackEvent).toHaveBeenCalledOnce();
      const [name, attributes] = trackEvent.mock.calls[0]!;
      expect(name).toBe(STATE_TRANSITION_EVENT);
      expect(attributes).toMatchObject(ATTRIBUTES);
      expect(JSON.stringify(attributes)).not.toContain('order-1');
    });

    it('does not warn about a dropped event when nothing subscribes', () => {
      const warn = initWith([]);
      transition(PAID);

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
