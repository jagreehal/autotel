// The model answered a question about refund policy. The answer was fluent and
// wrong. Token counts and latency will never tell you that, so put the
// evaluation score on the same trace as the cost and read them together.
//
// This calls a real model on your machine. Every number printed below came off
// a span the AI SDK emitted. Nothing in this file hand-writes a token count.

import { withTracing } from 'autotel';
import { generateText } from 'ai-sdk-ollama';
import { recordEvaluationResult } from 'autotel-genai/events';
import { collectGenAiSpans, reachOllama, skip } from './_ollama.js';

const model = await reachOllama();
if (!model) {
  skip('OE 21');
  process.exit(0);
}

const exporter = collectGenAiSpans('oe-21');

// The evaluation belongs to your operation. The token usage belongs to the
// model call underneath it. The trace is what joins them.
const answerPolicyQuestion = withTracing({ name: 'support.answer' })(
  (ctx) => async () => {
    const result = await generateText({
      model,
      prompt:
        'A customer asks: can I return an opened item after 40 days? ' +
        'Our returns policy is 30 days, opened or not. Answer in one sentence.',
      telemetry: { functionId: 'refund-policy' },
    });

    // Grade one testable fact rather than the whole answer: a useful reply
    // states the 30-day window, because that is what the customer has to know
    // to act. Scoring the refusal instead means writing a regex for every way
    // a model can say no, and grading your own regex is not an evaluation. A
    // production evaluator is a rubric or a judge model; what matters here is
    // that its verdict lands on the trace next to the tokens it cost.
    const citedWindow = /\b30[\s-]?(day|days)?\b/i.test(result.text);

    recordEvaluationResult(ctx, {
      name: 'refund_policy_accuracy',
      scoreValue: citedWindow ? 1 : 0,
      scoreLabel: citedWindow ? 'pass' : 'fail',
      explanation: 'reply states the 30-day returns window',
    });

    return { text: result.text, citedWindow };
  },
);

const { text, citedWindow } = await answerPolicyQuestion();

const chat = exporter
  .getFinishedSpans()
  .find((span) => span.attributes['gen_ai.usage.input_tokens'] !== undefined);

if (!chat) {
  throw new Error('The AI SDK call emitted no span carrying token usage');
}

const inputTokens = Number(chat.attributes['gen_ai.usage.input_tokens']);
const outputTokens = Number(chat.attributes['gen_ai.usage.output_tokens']);

if (!(inputTokens > 0) || !(outputTokens > 0)) {
  throw new Error('The model call recorded no real token usage');
}

console.log('OE 21: cost and quality on one trace, so you can divide them');
console.log(
  `  ${chat.name}: ${inputTokens} tokens in, ${outputTokens} out, measured`,
);
console.log(`  refund_policy_accuracy: ${citedWindow ? 'pass' : 'fail'}`);
console.log(`  it said: ${text.replace(/\s+/g, ' ').trim().slice(0, 88)}`);
console.log(
  '  a wrong answer bills the same as a right one, which is the point',
);
