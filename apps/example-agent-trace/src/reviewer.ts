/**
 * The test the essay proposes: if a reviewer cannot reconstruct why the agent
 * did what it did from the trace alone, the trace is a log wearing the wrong
 * badge.
 *
 * This reviewer gets the exported spans and the events that carry their trace
 * ids. It never sees the agent's source, its return value, or the process it
 * ran in. Each question below either has an answer in that record or does not.
 */
import type { Attributes } from '@opentelemetry/api';
import type { EventAttributes } from 'autotel';
import type { RecordedSpan } from 'autotel/testing';

export interface RecordedEvent {
  name: string;
  attributes: EventAttributes;
}

export interface Question {
  question: string;
  answer: string | null;
}

const str = (attributes: Attributes, key: string): string | null => {
  const value = attributes[key];
  return value === undefined ? null : String(value);
};

const num = (attributes: Attributes, key: string): number | null => {
  const value = Number(attributes[key]);
  return Number.isFinite(value) ? value : null;
};

export function review(
  spans: RecordedSpan[],
  events: RecordedEvent[],
): Question[] {
  const llmSpans = spans.filter((s) => s.attributes['gen_ai.request.model']);
  const toolSpans = spans.filter((s) => s.attributes['tool.name']);
  const workflow = spans.find((s) => s.attributes['workflow.name']);
  const steps = spans.filter((s) => s.attributes['workflow.step.name']);
  const retry = spans.find((s) => s.attributes['agent.retry.attempt']);
  const evaluations = events.filter(
    (e) => e.attributes['gen_ai.evaluation.name'] !== undefined,
  );

  const last = llmSpans.at(-1);
  const cost = llmSpans.reduce(
    (total, s) => total + (num(s.attributes, 'gen_ai.usage.cost.usd') ?? 0),
    0,
  );

  return [
    {
      question: 'Which model ran, and which version of the agent?',
      answer:
        last && workflow
          ? `${str(last.attributes, 'gen_ai.request.model')} answered as ${str(
              last.attributes,
              'gen_ai.response.model',
            )}, agent ${str(workflow.attributes, 'workflow.version')}`
          : null,
    },
    {
      question: 'What context did the model see when it chose?',
      answer: last ? str(last.attributes, 'gen_ai.input.messages') : null,
    },
    {
      question: 'What did it produce?',
      answer: last ? str(last.attributes, 'gen_ai.output.messages') : null,
    },
    {
      question: 'How many tokens, and what did the run cost?',
      answer: llmSpans.length
        ? `${llmSpans.reduce((t, s) => t + (num(s.attributes, 'gen_ai.usage.input_tokens') ?? 0), 0)} in, ` +
          `${llmSpans.reduce((t, s) => t + (num(s.attributes, 'gen_ai.usage.output_tokens') ?? 0), 0)} out, ` +
          `$${cost.toFixed(6)} across ${llmSpans.length} calls`
        : null,
    },
    {
      question: 'Which checks judged the answer, and how did they score it?',
      answer: evaluations.length
        ? evaluations
            .map(
              (e) =>
                `${e.attributes['gen_ai.evaluation.name']}=${e.attributes['gen_ai.evaluation.score.label']} (${e.attributes['gen_ai.evaluation.explanation']})`,
            )
            .join(', ')
        : null,
    },
    {
      question: 'Was there a retry, and what did it change?',
      answer: retry
        ? `attempt ${str(retry.attributes, 'agent.retry.attempt')} after: ${str(
            retry.attributes,
            'agent.retry.reason',
          )}`
        : null,
    },
    {
      question: 'Which tool ran, and can its arguments be tied to its result?',
      answer: toolSpans.length
        ? toolSpans
            .map(
              (s) =>
                `${str(s.attributes, 'tool.name')} ${str(s.attributes, 'tool.status')}, ` +
                `input ${str(s.attributes, 'tool.input_hash')?.slice(0, 12)} → output ${str(
                  s.attributes,
                  'tool.output_hash',
                )?.slice(0, 12)}`,
            )
            .join(', ')
        : null,
    },
    {
      question: 'Where did the run get to before it acted?',
      answer: steps.length
        ? steps
            .sort(
              (a, b) =>
                (num(a.attributes, 'workflow.step.index') ?? 0) -
                (num(b.attributes, 'workflow.step.index') ?? 0),
            )
            .map((s) => str(s.attributes, 'workflow.step.name'))
            .join(' → ')
        : null,
    },
  ];
}

export const unanswered = (questions: Question[]): Question[] =>
  questions.filter((q) => q.answer === null);
