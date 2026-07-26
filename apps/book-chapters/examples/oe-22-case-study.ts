import { withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { recordEvaluationResult } from 'autotel-genai/events';
import { recordGenAiUsage } from 'autotel-genai/trace';
import { createSloTracker } from 'autotel/slo';

const collector = createTraceCollector();
const resolution = createSloTracker(
  { name: 'support.resolution', target: 0.8, windowMs: 24 * 60 * 60_000 },
  { recordMetrics: false },
);
const firstToken = createSloTracker(
  { name: 'support.time_to_first_token', target: 0.95, windowMs: 60 * 60_000 },
  { recordMetrics: false },
);

const answerCustomer = withTracing({ name: 'support.answer' })(
  (ctx) => (timeToFirstTokenMs: number, resolved: boolean) => {
    ctx.setAttributes({
      'support.resolved': resolved,
      'gen_ai.response.time_to_first_token_ms': timeToFirstTokenMs,
      'support.workflow.version': 'retrieval-v2',
    });
    recordGenAiUsage(
      ctx,
      'gpt-4o',
      { inputTokens: 320, outputTokens: 84 },
      { recordCost: false },
    );
    recordEvaluationResult(ctx, {
      name: 'support_empathy',
      scoreValue: 0.91,
      scoreLabel: 'pass',
    });
    resolution.record(resolved ? 'good' : 'bad');
    firstToken.record(timeToFirstTokenMs <= 800 ? 'good' : 'bad');
  },
);

answerCustomer(620, true);

const inference = collector.expectSpan('support.answer');
if (
  inference.attributes['support.resolved'] !== true ||
  resolution.snapshot().sli !== 1 ||
  firstToken.snapshot().sli !== 1
) {
  throw new Error(
    'The support change lacks outcome, latency, or quality evidence',
  );
}

console.log(
  'OE 22: measured one LLM support change across product constraints',
);
console.log('  resolved: yes, time to first token: 620 ms, empathy: 0.91');
