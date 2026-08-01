// A support agent built on an LLM ships a retrieval change. Three things have
// to hold at once: the customer gets the actual answer, the first token arrives
// fast enough to feel live, and the reply stays short enough to read. Put all
// three on one trace and a single query tells you whether the change earned its
// place.
//
// This streams from a real model, so the latency below is measured rather than
// asserted. Some runs miss the bar. That is what the SLO is for.

import { withTracing } from 'autotel';
import { createSloTracker } from 'autotel/slo';
import { streamText } from 'ai-sdk-ollama';
import { recordEvaluationResult } from 'autotel-genai/events';
import { collectGenAiSpans, reachOllama, skip } from './_ollama.js';

const model = await reachOllama();
if (!model) {
  skip('OE 22');
  process.exit(0);
}

const FIRST_TOKEN_BAR_MS = 800;
const BREVITY_BAR_CHARS = 400;

const exporter = collectGenAiSpans('oe-22');
const resolution = createSloTracker(
  { name: 'support.resolution', target: 0.8, windowMs: 24 * 60 * 60_000 },
  { recordMetrics: false },
);
const firstToken = createSloTracker(
  { name: 'support.time_to_first_token', target: 0.95, windowMs: 60 * 60_000 },
  { recordMetrics: false },
);

const answerCustomer = withTracing({ name: 'support.answer' })(
  (ctx) => async () => {
    ctx.setAttributes({ 'support.workflow.version': 'retrieval-v2' });

    // ai-sdk-ollama's streamText resolves to the stream, unlike the ai core one.
    const stream = await streamText({
      model,
      prompt:
        'A customer asks when they can return an item. Our returns policy is ' +
        '30 days. Reply in one short sentence, stating the window.',
      telemetry: { functionId: 'support-answer' },
    });

    let reply = '';
    for await (const delta of stream.textStream) reply += delta;

    // Constraint 1: did the customer leave with the fact they came for?
    const resolved = /\b30[\s-]?day/i.test(reply) || reply.includes('30');
    // Constraint 3: a wall of text reads as a bot, however correct it is.
    const brief = reply.trim().length <= BREVITY_BAR_CHARS;

    recordEvaluationResult(ctx, {
      name: 'support_brevity',
      scoreValue: reply.trim().length,
      scoreLabel: brief ? 'pass' : 'fail',
    });
    ctx.setAttributes({ 'support.resolved': resolved });

    return { reply, resolved, brief };
  },
);

const { reply, resolved, brief } = await answerCustomer();

// Constraint 2: the AI SDK span carries the measured time to first chunk.
const chat = exporter
  .getFinishedSpans()
  .find(
    (span) =>
      span.attributes['gen_ai.response.time_to_first_chunk'] !== undefined,
  );

if (!chat) {
  throw new Error('The streamed call emitted no time-to-first-chunk timing');
}

const firstTokenMs =
  Number(chat.attributes['gen_ai.response.time_to_first_chunk']) * 1_000;

resolution.record(resolved ? 'good' : 'bad');
firstToken.record(firstTokenMs <= FIRST_TOKEN_BAR_MS ? 'good' : 'bad');

// The assertion is that all three constraints were measured, not that all three
// passed. A run that misses the latency bar still has to show its evidence.
if (
  resolution.snapshot().sli === undefined ||
  firstToken.snapshot().sli === undefined ||
  !Number.isFinite(firstTokenMs)
) {
  throw new Error(
    'The support change lacks outcome, latency, or quality evidence',
  );
}

const verdict = resolved && brief && firstTokenMs <= FIRST_TOKEN_BAR_MS;

console.log(
  `OE 22: retrieval-v2 held ${[resolved, firstTokenMs <= FIRST_TOKEN_BAR_MS, brief].filter(Boolean).length} of 3 constraints`,
);
console.log(`  resolved: ${resolved ? 'yes' : 'no'}`);
console.log(
  `  first token: ${firstTokenMs.toFixed(0)} ms against a ${FIRST_TOKEN_BAR_MS} ms bar`,
);
console.log(
  `  brevity: ${reply.trim().length} chars against a ${BREVITY_BAR_CHARS} char bar`,
);
console.log(
  verdict
    ? '  ship it, and keep all three on the span so the next change is comparable'
    : '  one constraint missed, which you only know because all three are recorded',
);
