// A burn alert that fires on every blip trains the team to ignore it. Two
// windows fix that: a short one to catch the spike, a long one to prove it
// lasted. Then project the recent failure rate forward and ask whether the
// error budget survives the next day.

import {
  createSloTracker,
  evaluateBurnRateAlert,
  type SloTracker,
} from 'autotel/slo';

function addTraffic(tracker: SloTracker, good: number, bad: number): void {
  for (let index = 0; index < good; index += 1) tracker.record('good');
  for (let index = 0; index < bad; index += 1) tracker.record('bad');
}

const definition = { name: 'checkout.availability', target: 0.99 };
const short = createSloTracker(
  { ...definition, windowMs: 5 * 60_000 },
  { recordMetrics: false },
);
const long = createSloTracker(
  { ...definition, windowMs: 60 * 60_000 },
  { recordMetrics: false },
);

addTraffic(short, 80, 20);
addTraffic(long, 90, 10);

const decision = evaluateBurnRateAlert({
  shortWindow: short.snapshot(),
  longWindow: long.snapshot(),
  shortThreshold: 14,
  longThreshold: 6,
});

if (!decision.alerting) throw new Error('Expected a sustained burn-rate alert');

let predictiveNow = 0;
const predictive = createSloTracker(
  {
    name: 'checkout.availability',
    target: 0.99,
    windowMs: 30 * 24 * 60 * 60_000,
  },
  { now: () => predictiveNow, recordMetrics: false },
);
addTraffic(predictive, 9_950, 0);
predictiveNow = 29 * 24 * 60 * 60_000;
addTraffic(predictive, 25, 25);
const forecast = predictive.forecast({
  baselineMs: 6 * 60 * 60_000,
  lookaheadMs: 24 * 60 * 60_000,
  expectedEventsInLookahead: 1_440,
});

if (!forecast.alerting || forecast.projectedSli === undefined) {
  throw new Error('Expected the forecast to exhaust the error budget');
}

console.log('OE 12: the spike is real, and it is still burning');
console.log(
  `  5 minutes at ${decision.shortBurnRate.toFixed(1)}x and 1 hour at ${decision.longBurnRate.toFixed(1)}x, both past threshold`,
);
console.log(
  `  projected 24 hours out: ${(forecast.projectedSli * 100).toFixed(1)}% against a 99% target, so page now`,
);
