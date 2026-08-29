/**
 * The gate that fires between runs.
 *
 * A system that learns from its own traces needs a fitness function, or it
 * does not improve, it drifts. Here the fitness function is the eval suite,
 * and the bar is the released procedure: a candidate ships only when it scores
 * at least as well as the version already in production.
 *
 * Two candidates go through the gate. One is worse and gets refused. One is
 * better and gets promoted. Both decisions land on a trace with the numbers
 * that justified them.
 */
import assert from 'node:assert/strict';
import { init, flush, trace, ctx } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import { MockEventSubscriber } from 'autotel-subscribers/testing';
import { recordEvaluationResult, recordPolicyDecision } from 'autotel-genai';

const spanCollector = createMemoryExporter();
const eventSubscriber = new MockEventSubscriber();

init({
  service: 'refund-agent',
  sampling: 'development',
  spanExporters: [spanCollector],
  subscribers: [eventSubscriber],
});

interface Case {
  id: string;
  amountGbp: number;
  daysSincePurchase: number;
  /** What a correct procedure decides for this case. */
  expected: 'auto' | 'review';
}

/** The suite. Yesterday's incidents become today's cases. */
const SUITE: Case[] = [
  { id: 'small-fresh', amountGbp: 40, daysSincePurchase: 2, expected: 'auto' },
  { id: 'small-old', amountGbp: 40, daysSincePurchase: 30, expected: 'review' },
  { id: 'mid-fresh', amountGbp: 180, daysSincePurchase: 5, expected: 'auto' },
  { id: 'mid-edge', amountGbp: 249, daysSincePurchase: 13, expected: 'auto' },
  {
    id: 'over-limit',
    amountGbp: 260,
    daysSincePurchase: 3,
    expected: 'review',
  },
  {
    id: 'over-limit-old',
    amountGbp: 900,
    daysSincePurchase: 40,
    expected: 'review',
  },
  {
    id: 'boundary-amount',
    amountGbp: 250,
    daysSincePurchase: 1,
    expected: 'review',
  },
  {
    id: 'boundary-days',
    amountGbp: 100,
    daysSincePurchase: 14,
    expected: 'review',
  },
];

type Procedure = (input: Case) => 'auto' | 'review';

/** The released procedure. It checks the amount and forgets the age. */
const v1: Procedure = (c) => (c.amountGbp < 250 ? 'auto' : 'review');

/** A candidate that widens the window. It also breaks the amount ceiling. */
const v2: Procedure = (c) => (c.daysSincePurchase < 21 ? 'auto' : 'review');

/** A candidate that adds the age rule the released version is missing. */
const v3: Procedure = (c) =>
  c.amountGbp <= 249 && c.daysSincePurchase <= 13 ? 'auto' : 'review';

/** Score one procedure over the suite, one span and one evaluation per case. */
const scoreProcedure = trace(
  'eval-suite',
  async (version: string, procedure: Procedure) => {
    const failures: string[] = [];
    for (const testCase of SUITE) {
      const actual = procedure(testCase);
      const pass = actual === testCase.expected;
      if (!pass) failures.push(testCase.id);
      recordEvaluationResult(ctx, {
        name: 'refund-routing',
        scoreValue: pass ? 1 : 0,
        scoreLabel: pass ? 'pass' : 'fail',
        explanation: `${testCase.id}: expected ${testCase.expected}, got ${actual}`,
        responseId: `${version}:${testCase.id}`,
      });
    }
    const passRate = (SUITE.length - failures.length) / SUITE.length;
    ctx.setAttributes({
      'eval.suite': 'refund-routing',
      'eval.version': version,
      'eval.pass_rate': passRate,
      'eval.cases': SUITE.length,
    });
    return { version, passRate, failures };
  },
);

/** The gate. A candidate ships only if it holds the released score. */
const releaseGate = trace(
  'release-gate',
  async (
    candidate: { version: string; passRate: number; failures: string[] },
    baseline: { version: string; passRate: number },
  ) => {
    const promote = candidate.passRate >= baseline.passRate;
    ctx.setAttributes({
      'eval.candidate.version': candidate.version,
      'eval.candidate.pass_rate': candidate.passRate,
      'eval.baseline.version': baseline.version,
      'eval.baseline.pass_rate': baseline.passRate,
    });
    recordPolicyDecision({
      action: 'agent.procedure.promote',
      resource: `refund-routing/${candidate.version}`,
      agent: { id: 'refund-agent', version: candidate.version },
      policy: {
        decision: promote ? 'permit' : 'deny',
        policyId: 'adlc/eval-baseline',
        reason: promote
          ? `${pct(candidate.passRate)} holds the released ${pct(baseline.passRate)}`
          : `${pct(candidate.passRate)} below the released ${pct(baseline.passRate)}: ${candidate.failures.join(', ')}`,
      },
      // Widening what the agent may do is a deployment, so it carries the same
      // review flag as any other change to production behaviour.
      governance: { reviewRequired: !promote, lifecycleStage: 'deploy' },
    });
    return promote;
  },
);

const pct = (n: number) => `${Math.round(n * 100)}%`;

async function main() {
  const baseline = await scoreProcedure('v1', v1);
  const candidateB = await scoreProcedure('v2', v2);
  const candidateC = await scoreProcedure('v3', v3);

  const shipB = await releaseGate(candidateB, baseline);
  const shipC = await releaseGate(candidateC, baseline);
  await flush();

  console.log(`\nBaseline ${baseline.version}: ${pct(baseline.passRate)}`);
  for (const candidate of [candidateB, candidateC]) {
    console.log(
      `Candidate ${candidate.version}: ${pct(candidate.passRate)}` +
        (candidate.failures.length
          ? ` (failed: ${candidate.failures.join(', ')})`
          : ''),
    );
  }
  console.log(
    `\nShipped: ${[shipB && 'v2', shipC && 'v3'].filter(Boolean).join(', ') || 'nothing'}\n`,
  );

  const gates = spanCollector
    .spans()
    .filter((s) => s.attributes['eval.candidate.version'] !== undefined);
  const denied = gates.find((s) => s.attributes['policy.decision'] === 'deny');
  const allowed = gates.find(
    (s) => s.attributes['policy.decision'] === 'permit',
  );
  const evaluations = eventSubscriber.events.filter(
    (e) => e.name === 'gen_ai.evaluation.result',
  );

  // The worse candidate was refused, and the refusal names the cases.
  assert.equal(shipB, false, 'a candidate below the baseline must not ship');
  assert.equal(shipC, true, 'a candidate that holds the baseline should ship');
  assert.ok(denied, 'the refusal should be on a trace as a policy decision');
  assert.ok(
    String(denied?.attributes['policy.reason']).includes('over-limit'),
    'the refusal should name the cases that broke',
  );
  assert.equal(allowed?.attributes['eval.candidate.version'], 'v3');
  assert.equal(
    denied?.attributes['governance.review_required'],
    true,
    'a refused candidate should be flagged for review, not silently dropped',
  );

  // Every case of every run is on the record, so a regression is one query,
  // not a rerun.
  assert.equal(
    evaluations.length,
    SUITE.length * 3,
    'each case of each version should leave an evaluation event',
  );

  console.log(
    'Assertions passed: the regression was refused, the improvement shipped, both are on the record.',
  );
}

await main();
