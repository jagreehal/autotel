import {
  DeterministicSampler,
  KeyTargetRateSampler,
  hashUnitInterval,
  type SamplingContext,
} from 'autotel/sampling';

const contextFor = (name: string): SamplingContext => ({
  operationName: name,
  args: [],
});

// Consistent sampling: two services must agree, or the waterfall has holes.
const options = {
  sampleRate: 0.25,
  key: (context: SamplingContext) => context.operationName,
};
const api = new DeterministicSampler(options);
const worker = new DeterministicSampler(options);

const traceIds = Array.from({ length: 400 }, (_, i) => `trace-${i}`);
const disagreements = traceIds.filter(
  (id) =>
    api.shouldSample(contextFor(id)) !== worker.shouldSample(contextFor(id)),
);

if (disagreements.length > 0) {
  throw new Error('Independent services disagreed on a trace');
}

const kept = traceIds.filter((id) => api.shouldSample(contextFor(id))).length;
console.log('OE 15: sample with an explicit loss policy');
console.log(
  `  consistent: ${disagreements.length} disagreements, kept ${kept}/400 at a 25% target`,
);
console.log(`  each kept trace represents ${api.sampleRate()} traces`);

// Per-key target rates: keep the rare operation, thin the busy one.
const perKey = new KeyTargetRateSampler({
  key: (context) => context.operationName,
  targetPerKey: 10,
  windowMs: 50,
});

for (let i = 0; i < 1_000; i++)
  perKey.shouldSample(contextFor('checkout.list'));
for (let i = 0; i < 4; i++) perKey.shouldSample(contextFor('checkout.refund'));

// Let the window roll so the observed counts become rates.
await new Promise((resolve) => setTimeout(resolve, 60));
perKey.shouldSample(contextFor('checkout.list'));

const busyRate = perKey.sampleRate(contextFor('checkout.list'));
const rareRate = perKey.sampleRate(contextFor('checkout.refund'));

if (rareRate !== 1 || busyRate <= 1) {
  throw new Error('Per-key rates did not adapt to the observed traffic');
}

console.log(
  `  per key: checkout.list now 1 in ${busyRate.toFixed(0)}, checkout.refund still 1 in ${rareRate}`,
);
console.log(
  '  autotel records autotel.sampling.rate so COUNT * rate estimates the population',
);

// The hash spreads keys that share a prefix, so a rate means what it says.
const tenantKeys = Array.from(
  { length: 1_000 },
  (_, i) => `tenant_${2000 + i}`,
);
const share =
  tenantKeys.filter((key) => hashUnitInterval(key) < 0.1).length / 1_000;
console.log(`  prefixed keys at a 10% rate: ${(share * 100).toFixed(1)}% kept`);
