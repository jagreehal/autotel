import { withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { recordEvaluationResult } from 'autotel-genai/events';
import { recordGenAiUsage } from 'autotel-genai/trace';

const collector = createTraceCollector();
const evaluateAnswer = withTracing({ name: 'chat gpt-4o' })((ctx) => () => {
  recordGenAiUsage(
    ctx,
    'gpt-4o',
    { inputTokens: 120, outputTokens: 40 },
    { recordCost: false },
  );
  recordEvaluationResult(ctx, {
    name: 'checkout_policy_accuracy',
    scoreValue: 0.92,
    scoreLabel: 'pass',
    responseId: 'response_42',
  });
});

evaluateAnswer();

const inference = collector.expectSpan('chat gpt-4o');
if (inference.attributes['gen_ai.usage.input_tokens'] !== 120) {
  throw new Error('Expected canonical token usage on the inference span');
}

console.log('OE 21: linked token usage and a quality evaluation to one trace');
console.log('  evaluation: checkout_policy_accuracy = 0.92');
