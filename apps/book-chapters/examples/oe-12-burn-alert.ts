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

console.log('OE 12: relative and predictive burn alerts');
console.log(
  `  short: ${decision.shortBurnRate.toFixed(1)}x, long: ${decision.longBurnRate.toFixed(1)}x`,
);
console.log(
  `  projected SLI after 24 hours: ${(forecast.projectedSli * 100).toFixed(1)}%`,
);
