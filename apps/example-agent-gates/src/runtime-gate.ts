/**
 * The gate that fires while the agent is running.
 *
 * Two things stand between a confident agent and an irreversible action here:
 * a guard that watches the run for loops and spend, and a human who has to
 * approve the refund. Both refusals are recorded, because a refusal nobody can
 * see is indistinguishable from a bug.
 */
import assert from 'node:assert/strict';
import { init, flush, trace, ctx } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import { MockEventSubscriber } from 'autotel-subscribers/testing';
import {
  createGenAiGuard,
  spinLoop,
  costCeiling,
  maxToolCalls,
  estimateLLMCost,
  defineAgentToolCall,
  recordPolicyDecision,
} from 'autotel-genai';
import { recordHumanApproval } from 'autotel-genai/agent';

const MODEL = 'claude-sonnet-4-6-20251101';
const spanCollector = createMemoryExporter();
const eventSubscriber = new MockEventSubscriber();

init({
  service: 'refund-agent',
  sampling: 'development',
  spanExporters: [spanCollector],
  subscribers: [eventSubscriber],
});

/** The action you do not get to take twice. */
const issueRefund = defineAgentToolCall(
  (ticketId: string) => ({
    action: 'agent.refund.issue',
    resource: 'payments_v3',
    agent: { id: 'refund-agent', model: MODEL },
    tool: { name: 'issue_refund', input: { ticketId } },
  }),
  () => async (ticketId: string) => ({ refundId: `re_${ticketId}` }),
);

/** An agent that has decided the answer is one more search away. */
const runawayAgent = trace('refund-agent.run', async (ticketId: string) => {
  const guard = createGenAiGuard({
    rules: [
      spinLoop({ count: 3, window: 6 }),
      costCeiling(0.5),
      maxToolCalls(20),
    ],
    onStop: 'abort',
  });

  let searches = 0;
  while (!guard.stopped && searches < 20) {
    searches++;
    // The same query every time. A human would notice on the second one.
    guard.record(
      {
        kind: 'tool',
        name: 'search_policy',
        signature: JSON.stringify({ query: 'refund policy' }),
        usage: {
          costUsd: estimateLLMCost(MODEL, {
            inputTokens: 900,
            outputTokens: 40,
          }),
        },
      },
      ctx,
    );
  }

  if (guard.stopped) {
    // The run ends here, before the tool that moves money.
    return { acted: false, searches, violations: [...guard.violations] };
  }

  await issueRefund(ticketId);
  return { acted: true, searches, violations: [] };
});

/** The same agent, sane this time, but the refund still needs a human. */
const supervisedAgent = trace(
  'refund-agent.supervised',
  async (ticketId: string, approved: boolean) => {
    recordHumanApproval({
      ctx,
      toolCallId: `call_${ticketId}`,
      toolName: 'issue_refund',
      approved,
      // `observed` because this process saw the decision. Left unsaid it
      // records `inferred`, which is the honest default for an approval
      // reconstructed from "the tool ran after a prompt".
      evidence: 'observed',
      controllerId: 'ops-7',
    });

    if (!approved) {
      recordPolicyDecision({
        action: 'agent.refund.blocked',
        agent: { id: 'refund-agent', model: MODEL },
        policy: {
          decision: 'deny',
          policyId: 'refunds/human-approval',
          reason: 'reviewer declined',
        },
      });
      return { acted: false };
    }

    await issueRefund(ticketId);
    return { acted: true };
  },
);

async function main() {
  const runaway = await runawayAgent('tkt-9001');
  const declined = await supervisedAgent('tkt-9002', false);
  const approved = await supervisedAgent('tkt-9003', true);
  await flush();

  const spans = spanCollector.spans();
  // A span carries `tool.name` as soon as an approval is recorded against it.
  // `tool.status` is what says the tool actually ran.
  const refundCalls = spans.filter(
    (s) =>
      s.attributes['tool.name'] === 'issue_refund' &&
      s.attributes['tool.status'] === 'complete',
  );
  const guardStops = eventSubscriber.events.filter(
    (e) => e.name === 'gen_ai.guard.stop',
  );
  const stopped = spans.find(
    (s) => s.attributes['gen_ai.guard.stopped'] === true,
  );

  console.log(
    `\nRunaway agent: ${runaway.searches} searches, acted: ${runaway.acted}`,
  );
  for (const violation of runaway.violations) {
    console.log(`  stopped by ${violation.rule}: ${violation.message}`);
  }
  console.log(
    `Session cost when it stopped: $${stopped?.attributes['gen_ai.session.cost.usd']}`,
  );
  console.log(
    `\nSupervised runs: declined acted=${declined.acted}, approved acted=${approved.acted}`,
  );
  console.log(
    `Completed refund tool calls on the trace: ${refundCalls.length}\n`,
  );

  // The loop was caught by a rule, not by a bill.
  assert.equal(
    runaway.acted,
    false,
    'the runaway agent must not reach the refund',
  );
  assert.ok(
    runaway.violations.some((v) => v.rule.startsWith('spin-loop')),
    'the spin-loop rule should be the one that fired',
  );
  assert.equal(
    guardStops.length,
    1,
    'the stop should be on the trace as an event',
  );
  assert.ok(stopped, 'the supervised span should carry gen_ai.guard.stopped');

  // One refund happened: the approved one. The declined run left evidence
  // rather than a silence.
  assert.equal(refundCalls.length, 1, 'exactly one refund should have run');
  const consent = spans.filter(
    (s) => s.attributes['agent.consent.outcome'] !== undefined,
  );
  assert.equal(
    consent.length,
    2,
    'both supervised runs should record a consent outcome',
  );

  console.log(
    'Assertions passed: the loop stopped short of the money, the refusal is on the trace.',
  );
}

await main();
