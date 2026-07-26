import { describe, expect, it } from 'vitest';
import { createSloTracker, evaluateBurnRateAlert } from './slo';

describe('createSloTracker()', () => {
  it('calculates SLI and error-budget burn rate', () => {
    let currentTime = 1000;
    const tracker = createSloTracker(
      { name: 'checkout.availability', target: 0.99, windowMs: 60_000 },
      { now: () => currentTime, recordMetrics: false },
    );

    for (let index = 0; index < 99; index += 1) tracker.record('good');
    const snapshot = tracker.record('bad');

    expect(snapshot.total).toBe(100);
    expect(snapshot.sli).toBeCloseTo(0.99);
    expect(snapshot.burnRate).toBeCloseTo(1);
    expect(snapshot.budgetRemaining).toBeCloseTo(0);
    expect(snapshot.meetsTarget).toBe(true);

    currentTime += 1;
    expect(tracker.record('bad').burnRate).toBeGreaterThan(1);
  });

  it('drops observations outside the rolling window', () => {
    let currentTime = 0;
    const tracker = createSloTracker(
      { name: 'api.success', target: 0.9, windowMs: 1000 },
      { now: () => currentTime, recordMetrics: false },
    );

    tracker.record('bad');
    currentTime = 1001;

    expect(tracker.snapshot()).toMatchObject({
      total: 0,
      good: 0,
      bad: 0,
      burnRate: 0,
    });
  });

  it('validates the objective', () => {
    expect(() =>
      createSloTracker(
        { name: '', target: 0.99, windowMs: 1000 },
        { recordMetrics: false },
      ),
    ).toThrow('name');
    expect(() =>
      createSloTracker(
        { name: 'bad-target', target: 1, windowMs: 1000 },
        { recordMetrics: false },
      ),
    ).toThrow('target');
  });

  it('forecasts error-budget exhaustion from a recent baseline', () => {
    let currentTime = 0;
    const tracker = createSloTracker(
      {
        name: 'checkout.availability',
        target: 0.99,
        windowMs: 30 * 24 * 60 * 60_000,
      },
      { now: () => currentTime, recordMetrics: false },
    );

    for (let index = 0; index < 9950; index += 1) tracker.record('good');
    currentTime = 29 * 24 * 60 * 60_000;
    for (let index = 0; index < 25; index += 1) tracker.record('good');
    for (let index = 0; index < 25; index += 1) tracker.record('bad');

    const forecast = tracker.forecast({
      baselineMs: 6 * 60 * 60_000,
      lookaheadMs: 24 * 60 * 60_000,
      expectedEventsInLookahead: 1440,
    });

    expect(forecast).toMatchObject({
      baselineTotal: 50,
      baselineBad: 25,
      retainedTotal: 10_000,
      projectedTotal: 11_440,
      projectedBad: 745,
      alerting: true,
      reason: 'projected-budget-exhaustion',
    });
    expect(forecast.projectedSli).toBeCloseTo((11_440 - 745) / 11_440);
    expect(forecast.timeToExhaustionMs).toBeGreaterThan(0);
  });

  it('limits forecasts to four baseline windows', () => {
    const tracker = createSloTracker(
      { name: 'api.success', target: 0.99, windowMs: 30 * 24 * 60 * 60_000 },
      { recordMetrics: false },
    );

    expect(() =>
      tracker.forecast({
        baselineMs: 60_000,
        lookaheadMs: 4 * 60_000 + 1,
      }),
    ).toThrow('4 times');
  });
});

describe('evaluateBurnRateAlert()', () => {
  const base = {
    name: 'checkout.availability',
    target: 0.99,
    observedAt: 1,
    total: 100,
    good: 95,
    bad: 5,
    sli: 0.95,
    errorBudgetFraction: 0.01,
    budgetConsumed: 5,
    budgetRemaining: -4,
    burnRate: 5,
    meetsTarget: false,
  };

  it('alerts only when both windows exceed their thresholds', () => {
    expect(
      evaluateBurnRateAlert({
        shortWindow: { ...base, windowMs: 5 * 60_000, burnRate: 14.5 },
        longWindow: { ...base, windowMs: 60 * 60_000, burnRate: 7 },
        shortThreshold: 14,
        longThreshold: 6,
      }),
    ).toMatchObject({
      alerting: true,
      reason: 'burn-rate-thresholds-exceeded',
    });
  });

  it('rejects a short spike without sustained burn', () => {
    expect(
      evaluateBurnRateAlert({
        shortWindow: { ...base, windowMs: 5 * 60_000, burnRate: 14.5 },
        longWindow: { ...base, windowMs: 60 * 60_000, burnRate: 2 },
        shortThreshold: 14,
        longThreshold: 6,
      }),
    ).toMatchObject({
      alerting: false,
      reason: 'long-window-below-threshold',
    });
  });
});
