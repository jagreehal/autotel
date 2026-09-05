// "Is checkout up?" has no answer you can act on. "Did 99.9% of checkouts
// succeed this month?" does. Pick the user action, pick the target, and use the
// error budget when you decide whether to ship on Friday.

import { createSloTracker } from 'autotel/slo';

const WINDOW_DAYS = 30;
let now = 1_000;
const availability = createSloTracker(
  {
    name: 'checkout.availability',
    target: 0.999,
    windowMs: WINDOW_DAYS * 24 * 60 * 60 * 1_000,
  },
  { now: () => now, recordMetrics: false },
);

for (let index = 0; index < 995; index += 1) {
  availability.record('good');
  now += 1;
}
for (let index = 0; index < 5; index += 1) {
  availability.record('bad');
  now += 1;
}

const snapshot = availability.snapshot();
if (snapshot.sli === undefined || snapshot.burnRate <= 1) {
  throw new Error('Expected checkout to consume its error budget too fast');
}

console.log('OE 11: 5 bad checkouts in 1,000, against a 99.9% target');
console.log(`  SLI ${(snapshot.sli * 100).toFixed(2)}%`);
console.log(
  `  burning at ${snapshot.burnRate.toFixed(1)}x, so the ${WINDOW_DAYS}-day budget is gone in ${(WINDOW_DAYS / snapshot.burnRate).toFixed(0)} days`,
);
