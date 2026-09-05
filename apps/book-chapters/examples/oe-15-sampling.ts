// Keeping every trace costs more than running the service. Dropping at random
// puts holes in the waterfall: the API keeps its span, the worker drops the
// child, and the trace you open is missing the part you came for.
//
// Chapter 15 answers this as a ladder, each rung fixing what the one below it
// broke. This walks all nine in the same order, in TypeScript. The authors'
// own Go implementations of these nine are in their companion repository under
// 2e/chapter-15-sampling; read them alongside this.

import {
  AdaptiveSampler,
  AlwaysSampler,
  AUTOTEL_SAMPLING_RATE,
  DeterministicSampler,
  hashUnitInterval,
  KeyTargetRateSampler,
  RandomSampler,
  type SamplingContext,
} from 'autotel/sampling';

const contextFor = (name: string, args: unknown[] = []): SamplingContext => ({
  operationName: name,
  args,
});

const TRACES = Array.from({ length: 400 }, (_, i) => `trace-${i}`);
const keptBy = (sampler: { shouldSample(c: SamplingContext): boolean }) =>
  TRACES.filter((id) => sampler.shouldSample(contextFor(id))).length;

console.log('OE 15: the sampling ladder, nine rungs');

// --- 1. Base case: record everything. Correct, and the bill proves it. ------
const everything = keptBy(new AlwaysSampler());
if (everything !== TRACES.length)
  throw new Error('AlwaysSampler dropped a trace');
console.log(`  1 keep everything      ${everything}/400, and you pay for 400`);

// --- 2. Fixed rate: cheap, and now every count you run is wrong. ------------
const fixed = new RandomSampler(0.25);
const keptFixed = keptBy(fixed);
// 400 trials at p=0.25 has mean 100. This band is five standard deviations out.
if (keptFixed < 55 || keptFixed > 145) {
  throw new Error(`A 25% rate kept ${keptFixed}/400, which is not 25%`);
}
console.log(
  `  2 fixed rate           ${keptFixed}/400 kept, and 400 is now unknowable`,
);

// --- 3. Record the rate so you can recover the count. -----------------------
// autotel writes this to every sampled span, so COUNT * rate estimates the
// population you dropped.
const estimate = keptFixed * fixed.sampleRate();
if (Math.abs(estimate - TRACES.length) > 200) {
  throw new Error('Reweighting did not recover the population');
}
console.log(
  `  3 record the rate      ${AUTOTEL_SAMPLING_RATE}=${fixed.sampleRate()}, so ${keptFixed} x ${fixed.sampleRate()} estimates ${estimate}`,
);

// --- 4. Consistent: two services must agree or the waterfall has holes. -----
const shared = {
  sampleRate: 0.25,
  key: (context: SamplingContext) => context.operationName,
};
const api = new DeterministicSampler(shared);
const worker = new DeterministicSampler(shared);
const disagreements = TRACES.filter(
  (id) =>
    api.shouldSample(contextFor(id)) !== worker.shouldSample(contextFor(id)),
).length;
if (disagreements > 0) throw new Error('Two services disagreed on a trace');

// The hash also has to spread keys that share a prefix, or a rate lies. Ids
// like tenant_2000..tenant_2999 land in one narrow band under a weak hash.
const prefixed = Array.from({ length: 1_000 }, (_, i) => `tenant_${2000 + i}`);
const spread =
  prefixed.filter((key) => hashUnitInterval(key) < 0.1).length / 10;
if (spread < 5 || spread > 15) {
  throw new Error(`Prefixed keys kept ${spread}% at a 10% rate`);
}
console.log(
  `  4 consistent           ${disagreements} disagreements over 400 traces, prefixed keys kept ${spread.toFixed(1)}% at 10%`,
);

// --- 5. Target rate: stop picking a rate, pick a volume. --------------------
const targetRate = new KeyTargetRateSampler({
  key: () => 'all',
  targetPerKey: 10,
  windowMs: 50,
});
for (let i = 0; i < 1_000; i++) targetRate.shouldSample(contextFor('checkout'));
await new Promise((resolve) => setTimeout(resolve, 60));
targetRate.shouldSample(contextFor('checkout'));
const settled = targetRate.sampleRate(contextFor('checkout'));
if (settled <= 1) throw new Error('The target rate never adjusted to traffic');
console.log(
  `  5 target rate          1,000 in a window settles to 1 in ${settled.toFixed(0)}, aiming at 10`,
);

// --- 6. Two rates: a low baseline, and keep every failure regardless. -------
const adaptive = new AdaptiveSampler({
  baselineSampleRate: 0.1,
  slowThresholdMs: 800,
});
const outcomes = [
  { success: true, duration: 120 },
  { success: false, duration: 90 },
  { success: true, duration: 1_400 },
];
const keptOutcomes = outcomes.map((result) => {
  const context = contextFor('checkout.submit', [result]);
  adaptive.shouldSample(context);
  return adaptive.shouldKeepTrace(context, result);
});
if (!keptOutcomes[1] || !keptOutcomes[2]) {
  throw new Error('Adaptive sampling dropped an error or a slow request');
}
console.log(
  '  6 baseline plus edges  10% of healthy traffic, 100% of errors and slow requests',
);

// --- 7. Key and target rate: one rate cannot serve a skewed workload. -------
const perKey = new KeyTargetRateSampler({
  key: (context) => context.operationName,
  targetPerKey: 10,
  windowMs: 50,
});
for (let i = 0; i < 1_000; i++)
  perKey.shouldSample(contextFor('checkout.list'));
for (let i = 0; i < 4; i++) perKey.shouldSample(contextFor('checkout.refund'));
await new Promise((resolve) => setTimeout(resolve, 60));
perKey.shouldSample(contextFor('checkout.list'));
const busy = perKey.sampleRate(contextFor('checkout.list'));
const rare = perKey.sampleRate(contextFor('checkout.refund'));
if (rare !== 1 || busy <= 1) {
  throw new Error('Per-key rates did not adapt to observed traffic');
}
console.log(
  `  7 key and target rate  checkout.list 1 in ${busy.toFixed(0)}, checkout.refund still 1 in ${rare}`,
);

// --- 8. Many keys: an unbounded key function is a memory leak wearing a ----
// --- sampler's clothes. Past maxKeys, the tail collapses into one bucket. ---
const manyKeys = new KeyTargetRateSampler({
  key: (context) => context.operationName,
  targetPerKey: 5,
  windowMs: 50,
  maxKeys: 100,
});
for (let tenant = 0; tenant < 500; tenant++) {
  manyKeys.shouldSample(contextFor(`tenant-${tenant}`));
}
await new Promise((resolve) => setTimeout(resolve, 60));
manyKeys.shouldSample(contextFor('tenant-0'));
console.log(
  '  8 many keys            100 tenants tracked by name, the other 400 share an overflow bucket',
);

// --- 9. Head and tail: the head cannot know the request was slow. ----------
// A head decision happens before the work runs, so it cannot keep what it has
// not seen yet. Autotel's TailSamplingSpanProcessor re-decides on the finished
// span; `46-sampling.ts` runs it inside a real exporter pipeline.
console.log(
  '  9 head and tail        head keeps the trace whole, tail keeps what turned out to matter',
);
console.log(
  '                         see 46-sampling.ts for the wired pipeline',
);
