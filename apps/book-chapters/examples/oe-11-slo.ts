import { createSloTracker } from 'autotel/slo';

let now = 1_000;
const availability = createSloTracker(
  {
    name: 'checkout.availability',
    target: 0.999,
    windowMs: 30 * 24 * 60 * 60 * 1_000,
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

console.log('OE 11: checkout availability');
console.log(`  SLI: ${(snapshot.sli * 100).toFixed(2)}%`);
console.log(`  burn rate: ${snapshot.burnRate.toFixed(1)}x`);
