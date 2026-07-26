/**
 * Service level objective tracking and burn-rate evaluation.
 *
 * The tracker keeps a bounded rolling window in memory, records low-cardinality
 * OpenTelemetry metrics, and returns snapshots that callers can feed into alert
 * evaluation. Production systems can persist the emitted metrics in their
 * telemetry backend while tests use the same calculations in process.
 */

import {
  trace as otelTrace,
  type Attributes,
  type Counter,
  type Histogram,
} from '@opentelemetry/api';
import { getConfig } from './config';

export type SloOutcome = 'good' | 'bad';

export interface SloDefinition {
  /** Stable identifier used in metric attributes and alerts. */
  name: string;
  /** Required success ratio, expressed as a value between 0 and 1. */
  target: number;
  /** Rolling observation window in milliseconds. */
  windowMs: number;
}

export interface SloTrackerOptions {
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Disable metric recording when calculations run outside an initialized SDK. */
  recordMetrics?: boolean;
}

export interface SloSnapshot extends SloDefinition {
  observedAt: number;
  total: number;
  good: number;
  bad: number;
  /** Observed good-event ratio. Undefined until the tracker sees an event. */
  sli?: number;
  /** Fraction of events the objective permits to fail. */
  errorBudgetFraction: number;
  /** Fraction of the available error budget consumed in this window. */
  budgetConsumed: number;
  /** Remaining budget fraction. Negative values show overspend. */
  budgetRemaining: number;
  /** Observed failure ratio divided by the permitted failure ratio. */
  burnRate: number;
  meetsTarget: boolean;
}

export interface SloTracker {
  readonly definition: Readonly<SloDefinition>;
  record(outcome: SloOutcome, attributes?: Attributes): SloSnapshot;
  snapshot(at?: number): SloSnapshot;
  forecast(options: SloForecastOptions): SloForecast;
  reset(): void;
}

export interface SloForecastOptions {
  /** Recent observation period used to estimate the future failure rate. */
  baselineMs: number;
  /** Future period covered by the forecast. Must not exceed 4x the baseline. */
  lookaheadMs: number;
  /**
   * Expected eligible events during the lookahead. Defaults to the event rate
   * observed during the baseline.
   */
  expectedEventsInLookahead?: number;
}

export interface SloForecast {
  name: string;
  target: number;
  observedAt: number;
  baselineMs: number;
  lookaheadMs: number;
  baselineTotal: number;
  baselineBad: number;
  baselineFailureRate: number;
  retainedTotal: number;
  retainedBad: number;
  projectedTotal: number;
  projectedBad: number;
  projectedSli?: number;
  /** Milliseconds until the retained and projected error budget is exhausted. */
  timeToExhaustionMs?: number;
  alerting: boolean;
  reason:
    'no-baseline-traffic' | 'within-budget' | 'projected-budget-exhaustion';
}

export interface BurnRateAlertOptions {
  shortWindow: SloSnapshot;
  longWindow: SloSnapshot;
  shortThreshold: number;
  longThreshold: number;
}

export interface BurnRateAlertDecision {
  alerting: boolean;
  reason:
    | 'burn-rate-thresholds-exceeded'
    | 'short-window-below-threshold'
    | 'long-window-below-threshold'
    | 'no-traffic';
  shortBurnRate: number;
  longBurnRate: number;
}

interface Observation {
  outcome: SloOutcome;
  timestamp: number;
}

function validateDefinition(definition: SloDefinition): void {
  if (!definition.name.trim()) {
    throw new Error('SLO name must not be empty');
  }
  if (
    !Number.isFinite(definition.target) ||
    definition.target <= 0 ||
    definition.target >= 1
  ) {
    throw new Error('SLO target must be greater than 0 and less than 1');
  }
  if (!Number.isFinite(definition.windowMs) || definition.windowMs <= 0) {
    throw new Error('SLO windowMs must be greater than 0');
  }
}

function validateThreshold(name: string, threshold: number): void {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error(`${name} must be greater than 0`);
  }
}

function validateForecastOptions(options: SloForecastOptions): void {
  if (!Number.isFinite(options.baselineMs) || options.baselineMs <= 0) {
    throw new Error('baselineMs must be greater than 0');
  }
  if (!Number.isFinite(options.lookaheadMs) || options.lookaheadMs <= 0) {
    throw new Error('lookaheadMs must be greater than 0');
  }
  if (options.lookaheadMs > options.baselineMs * 4) {
    throw new Error('lookaheadMs must not exceed 4 times baselineMs');
  }
  if (
    options.expectedEventsInLookahead !== undefined &&
    (!Number.isFinite(options.expectedEventsInLookahead) ||
      options.expectedEventsInLookahead < 0)
  ) {
    throw new Error('expectedEventsInLookahead must not be negative');
  }
}

/**
 * Track good and bad events for one rolling-window service level objective.
 */
export function createSloTracker(
  definition: SloDefinition,
  options: SloTrackerOptions = {},
): SloTracker {
  validateDefinition(definition);

  const stableDefinition = Object.freeze({ ...definition });
  const now = options.now ?? Date.now;
  const observations: Observation[] = [];
  let firstLiveIndex = 0;

  let outcomeCounter: Counter | undefined;
  let burnRateHistogram: Histogram | undefined;

  if (options.recordMetrics !== false) {
    const meter = getConfig().meter;
    outcomeCounter = meter.createCounter('autotel.slo.outcomes', {
      description:
        'Good and bad events recorded against a service level objective',
      unit: '1',
    });
    burnRateHistogram = meter.createHistogram('autotel.slo.burn_rate', {
      description: 'Error-budget burn rate for a service level objective',
      unit: '1',
    });
  }

  const prune = (at: number): void => {
    const cutoff = at - stableDefinition.windowMs;
    while (
      firstLiveIndex < observations.length &&
      observations[firstLiveIndex]!.timestamp < cutoff
    ) {
      firstLiveIndex += 1;
    }

    if (firstLiveIndex > 1024 && firstLiveIndex * 2 >= observations.length) {
      observations.splice(0, firstLiveIndex);
      firstLiveIndex = 0;
    }
  };

  const calculate = (at: number): SloSnapshot => {
    prune(at);

    let good = 0;
    for (let index = firstLiveIndex; index < observations.length; index += 1) {
      if (observations[index]!.outcome === 'good') good += 1;
    }

    const total = observations.length - firstLiveIndex;
    const bad = total - good;
    const sli = total === 0 ? undefined : good / total;
    const errorBudgetFraction = 1 - stableDefinition.target;
    const observedBadFraction = total === 0 ? 0 : bad / total;
    const burnRate = observedBadFraction / errorBudgetFraction;
    const budgetConsumed = burnRate;

    return {
      ...stableDefinition,
      observedAt: at,
      total,
      good,
      bad,
      sli,
      errorBudgetFraction,
      budgetConsumed,
      budgetRemaining: 1 - budgetConsumed,
      burnRate,
      meetsTarget: sli === undefined || sli >= stableDefinition.target,
    };
  };

  return {
    definition: stableDefinition,

    record(outcome: SloOutcome, attributes: Attributes = {}): SloSnapshot {
      if (outcome !== 'good' && outcome !== 'bad') {
        throw new Error('SLO outcome must be "good" or "bad"');
      }

      const timestamp = now();
      observations.push({ outcome, timestamp });
      const current = calculate(timestamp);
      const metricAttributes: Attributes = {
        ...attributes,
        'slo.name': stableDefinition.name,
        'slo.outcome': outcome,
      };

      outcomeCounter?.add(1, metricAttributes);
      burnRateHistogram?.record(current.burnRate, {
        'slo.name': stableDefinition.name,
      });

      const activeSpan = otelTrace.getActiveSpan();
      activeSpan?.setAttributes({
        'slo.name': stableDefinition.name,
        'slo.target': stableDefinition.target,
        'slo.outcome': outcome,
        'slo.burn_rate': current.burnRate,
      });

      return current;
    },

    snapshot(at = now()): SloSnapshot {
      return calculate(at);
    },

    forecast(forecastOptions: SloForecastOptions): SloForecast {
      validateForecastOptions(forecastOptions);
      if (forecastOptions.baselineMs > stableDefinition.windowMs) {
        throw new Error('baselineMs must not exceed the SLO windowMs');
      }
      const observedAt = now();
      prune(observedAt);

      const baselineCutoff = observedAt - forecastOptions.baselineMs;
      const retainedCutoff =
        observedAt + forecastOptions.lookaheadMs - stableDefinition.windowMs;
      let baselineTotal = 0;
      let baselineBad = 0;
      let retainedTotal = 0;
      let retainedBad = 0;

      for (
        let index = firstLiveIndex;
        index < observations.length;
        index += 1
      ) {
        const observation = observations[index]!;
        if (observation.timestamp >= baselineCutoff) {
          baselineTotal += 1;
          if (observation.outcome === 'bad') baselineBad += 1;
        }
        if (observation.timestamp >= retainedCutoff) {
          retainedTotal += 1;
          if (observation.outcome === 'bad') retainedBad += 1;
        }
      }

      if (baselineTotal === 0) {
        return {
          name: stableDefinition.name,
          target: stableDefinition.target,
          observedAt,
          baselineMs: forecastOptions.baselineMs,
          lookaheadMs: forecastOptions.lookaheadMs,
          baselineTotal: 0,
          baselineBad: 0,
          baselineFailureRate: 0,
          retainedTotal,
          retainedBad,
          projectedTotal: retainedTotal,
          projectedBad: retainedBad,
          projectedSli:
            retainedTotal === 0
              ? undefined
              : (retainedTotal - retainedBad) / retainedTotal,
          alerting: false,
          reason: 'no-baseline-traffic',
        };
      }

      const baselineFailureRate = baselineBad / baselineTotal;
      const expectedEventsInLookahead =
        forecastOptions.expectedEventsInLookahead ??
        (baselineTotal * forecastOptions.lookaheadMs) /
          forecastOptions.baselineMs;
      const projectedFailures = baselineFailureRate * expectedEventsInLookahead;
      const projectedTotal = retainedTotal + expectedEventsInLookahead;
      const projectedBad = retainedBad + projectedFailures;
      const projectedSli =
        projectedTotal === 0
          ? undefined
          : (projectedTotal - projectedBad) / projectedTotal;
      const allowedFailureRate = 1 - stableDefinition.target;
      const remainingFailures =
        allowedFailureRate * retainedTotal - retainedBad;
      const netFailureRate = baselineFailureRate - allowedFailureRate;
      const eventRate = expectedEventsInLookahead / forecastOptions.lookaheadMs;
      const timeToExhaustionMs =
        remainingFailures <= 0
          ? 0
          : netFailureRate > 0 && eventRate > 0
            ? remainingFailures / (netFailureRate * eventRate)
            : undefined;
      const alerting =
        projectedSli !== undefined && projectedSli < stableDefinition.target;

      return {
        name: stableDefinition.name,
        target: stableDefinition.target,
        observedAt,
        baselineMs: forecastOptions.baselineMs,
        lookaheadMs: forecastOptions.lookaheadMs,
        baselineTotal,
        baselineBad,
        baselineFailureRate,
        retainedTotal,
        retainedBad,
        projectedTotal,
        projectedBad,
        projectedSli,
        timeToExhaustionMs,
        alerting,
        reason: alerting ? 'projected-budget-exhaustion' : 'within-budget',
      };
    },

    reset(): void {
      observations.length = 0;
      firstLiveIndex = 0;
    },
  };
}

/**
 * Evaluate a dual-window burn-rate alert.
 *
 * Both windows must exceed their threshold. The short window catches a sharp
 * regression while the long window rejects brief spikes.
 */
export function evaluateBurnRateAlert(
  options: BurnRateAlertOptions,
): BurnRateAlertDecision {
  validateThreshold('shortThreshold', options.shortThreshold);
  validateThreshold('longThreshold', options.longThreshold);

  if (
    options.shortWindow.name !== options.longWindow.name ||
    options.shortWindow.target !== options.longWindow.target
  ) {
    throw new Error(
      'Burn-rate windows must describe the same SLO name and target',
    );
  }

  if (options.shortWindow.total === 0 || options.longWindow.total === 0) {
    return {
      alerting: false,
      reason: 'no-traffic',
      shortBurnRate: options.shortWindow.burnRate,
      longBurnRate: options.longWindow.burnRate,
    };
  }

  if (options.shortWindow.burnRate < options.shortThreshold) {
    return {
      alerting: false,
      reason: 'short-window-below-threshold',
      shortBurnRate: options.shortWindow.burnRate,
      longBurnRate: options.longWindow.burnRate,
    };
  }

  if (options.longWindow.burnRate < options.longThreshold) {
    return {
      alerting: false,
      reason: 'long-window-below-threshold',
      shortBurnRate: options.shortWindow.burnRate,
      longBurnRate: options.longWindow.burnRate,
    };
  }

  return {
    alerting: true,
    reason: 'burn-rate-thresholds-exceeded',
    shortBurnRate: options.shortWindow.burnRate,
    longBurnRate: options.longWindow.burnRate,
  };
}
