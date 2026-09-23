/**
 * Scores agent answers and ships the verdicts as `gen_ai.evaluation.result`
 * events on the trace of the conversation they judge.
 *
 * Cost and latency tell you the agent is running. Evaluations tell you it is
 * answering. This is the second half.
 *
 * Run: pnpm start
 * Conversation signals (fake Jev): EVAL_MODE=signals pnpm start
 */

import {
  init,
  span,
  flush,
  shutdown,
  getActiveTraceContext,
  type TraceContext,
} from 'autotel';
import { LokiSubscriber } from 'autotel-subscribers/loki';
import {
  traceGenAI,
  recordGenAiResponse,
  recordGenAiUsage,
  recordEvaluationResult,
  runConversationSignals,
  GEN_AI_OPERATION,
} from 'autotel-genai';

import { evaluate, type Answer } from './evaluators.js';
import { CONVERSATIONS } from './conversations.js';
import {
  SIGNAL_CONVERSATIONS,
  fakeConversationSignalModel,
} from './fake-signal-model.js';

/** Fraction of answers to score. Drop it when traffic grows. */
const SAMPLE_RATE = Number(process.env.EVAL_SAMPLE_RATE ?? 0.5);
const EVAL_MODE = process.env.EVAL_MODE ?? 'heuristic';

init({
  service: 'support-agent',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  sampling: 'development',
  // Evaluation results are events, and events reach a backend through a
  // subscriber. Without one `recordEvaluationResult` is a no-op.
  subscribers: [
    new LokiSubscriber({
      endpoint: process.env.LOKI_ENDPOINT || 'http://localhost:3100',
      labels: { service: 'support-agent' },
    }),
  ],
});

const answer = traceGenAI({
  provider: 'openai',
  model: 'gpt-4o-mini',
  operation: GEN_AI_OPERATION.CHAT,
})((ctx) => async (turn: Answer, index: number) => {
  await delay(30 + Math.random() * 90);

  recordGenAiResponse(ctx, { model: 'gpt-4o-mini', id: `resp-${index}` });
  recordGenAiUsage(ctx, 'gpt-4o-mini', {
    inputTokens: 300 + turn.question.length,
    outputTokens: Math.ceil(turn.text.length / 4),
  });

  return turn;
});

/**
 * Attach one verdict per evaluator to the conversation span. Same trace as the
 * call being judged, so a failing score and its answer open together.
 */
function score(ctx: TraceContext, result: Answer): number {
  let failures = 0;

  for (const verdict of evaluate(result)) {
    if (verdict.label === 'fail') failures++;
    recordEvaluationResult(ctx, {
      name: verdict.name,
      scoreValue: verdict.score,
      scoreLabel: verdict.label,
      explanation: verdict.explanation,
    });
  }

  ctx.setAttribute('gen_ai.evaluation.failed_count', failures);
  return failures;
}

async function runHeuristicEvals() {
  console.log(
    `\nAnswering ${CONVERSATIONS.length} questions, scoring ${Math.round(SAMPLE_RATE * 100)}% of them\n`,
  );

  let scored = 0;
  let failures = 0;

  for (const [index, turn] of CONVERSATIONS.entries()) {
    await span({ name: 'invoke_agent support-agent' }, async () => {
      const ctx = getActiveTraceContext()!;
      ctx.setAttribute('gen_ai.operation.name', GEN_AI_OPERATION.INVOKE_AGENT);
      ctx.setAttribute('gen_ai.agent.name', 'support-agent');
      ctx.setAttribute('gen_ai.conversation.id', `conv-${index}`);

      const result = await answer(turn, index);

      // Sample after the answer exists. Deciding earlier biases the sample
      // towards whatever the cheap path happens to produce.
      if (Math.random() < SAMPLE_RATE) {
        scored++;
        failures += score(ctx, result);
      }
    });
  }

  await flush();
  await shutdown();

  console.log(`Scored ${scored} answers, ${failures} verdicts failed.\n`);
  console.log('Pass rate, in Grafana Explore against Loki:');
  console.log(
    '  sum(count_over_time({service="support-agent"} | json | gen_ai_evaluation_score_label="pass" [15m]))',
  );
  console.log(
    '  /\n  sum(count_over_time({service="support-agent"} | json | gen_ai_evaluation_name!="" [15m]))\n',
  );
  console.log('Grafana: http://localhost:3000\n');
}

/**
 * Conversation signals: one evaluate pass per transcript, five yes/no events.
 * Uses an in-process fake model so the demo needs no TypeSafe key. Swap for
 * `typeSafeAi.evaluationModel('jev-1.13.0')` (pinned) in production.
 */
async function runSignalEvals() {
  const model = fakeConversationSignalModel();

  console.log(
    `\nScoring ${SIGNAL_CONVERSATIONS.length} conversations for conversation signals\n`,
  );

  let yesCount = 0;

  for (const fixture of SIGNAL_CONVERSATIONS) {
    await span({ name: 'invoke_agent support-agent' }, async () => {
      const ctx = getActiveTraceContext()!;
      ctx.setAttribute('gen_ai.operation.name', GEN_AI_OPERATION.INVOKE_AGENT);
      ctx.setAttribute('gen_ai.agent.name', 'support-agent');
      ctx.setAttribute('gen_ai.conversation.id', fixture.id);

      const { results } = await runConversationSignals(model, fixture.input, {
        cost: { recordCost: false },
      });

      const raised = results.filter((r) => r.scoreLabel === 'yes');
      yesCount += raised.length;
      console.log(
        `  ${fixture.id}: ${raised.map((r) => r.name).join(', ') || '(none)'}`,
      );
    });
  }

  await flush();
  await shutdown();

  console.log(`\n${yesCount} yes-labeled signals across the run.\n`);
  console.log('Signal rate in Loki (example: frustration):');
  console.log(
    '  sum(count_over_time({service="support-agent"} | json | gen_ai_evaluation_name="user_frustrated" | gen_ai_evaluation_score_label="yes" [15m]))\n',
  );
  console.log('Grafana: http://localhost:3000\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const main = EVAL_MODE === 'signals' ? runSignalEvals : runHeuristicEvals;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
