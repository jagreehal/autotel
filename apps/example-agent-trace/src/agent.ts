/**
 * A support agent that answers a refund question and, if the answer holds up,
 * issues the refund.
 *
 * The model is a stub: the point of this example is not what the model says,
 * it is what the run leaves behind. Every step records the model it ran, the
 * context it saw, the tokens it burned, the checks that judged it, and the
 * tool call it made, so a reviewer can reconstruct the decision afterwards
 * from the trace alone.
 */
import { ctx } from 'autotel';
import { traceStep, traceWorkflow } from 'autotel/workflow';
import {
  traceGenAI,
  recordGenAiResponse,
  recordGenAiUsage,
  setGenAiContent,
  recordEvaluationResult,
  defineAgentToolCall,
  GEN_AI_OPERATION,
} from 'autotel-genai';

const MODEL = 'claude-sonnet-4-6-20251101';
const AGENT_VERSION = '2026-08-29.1';

export interface Ticket {
  id: string;
  question: string;
  amountGbp: number;
}

interface Draft {
  answer: string;
  citedPolicy: string | null;
  responseId: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** A stub model. The first draft forgets to cite a policy; the retry does not. */
function callModel(messages: string[]): Draft {
  const toldToCite = messages.some((m) => m.includes('cite the policy'));
  return {
    answer: toldToCite
      ? 'Refunds under £250 are approved automatically within 14 days of purchase.'
      : 'Yes, you can have your money back.',
    citedPolicy: toldToCite ? 'refunds-v4#automatic' : null,
    responseId: toldToCite ? 'resp_2' : 'resp_1',
    usage: {
      inputTokens: messages.join(' ').length,
      outputTokens: toldToCite ? 38 : 11,
    },
  };
}

/**
 * One LLM call. `traceGenAI` names the span and sets the request attributes;
 * the three record helpers put the response, the tokens and the estimated cost
 * beside them.
 */
const draft = traceGenAI({
  provider: 'anthropic',
  model: MODEL,
  operation: GEN_AI_OPERATION.CHAT,
  temperature: 0.2,
})((genAiCtx) => async (messages: string[]) => {
  const result = callModel(messages);

  // Content capture is opt-in because it can carry PII. This example runs on
  // synthetic tickets, so it captures both sides: without the input messages
  // no reviewer can say what the model was looking at when it chose.
  setGenAiContent(genAiCtx, {
    inputMessages: messages.map((text) => ({
      role: 'user',
      parts: [{ type: 'text', content: text }],
    })),
    outputMessages: result.answer,
  });
  recordGenAiResponse(genAiCtx, {
    model: MODEL,
    id: result.responseId,
    finishReasons: ['stop'],
  });
  recordGenAiUsage(genAiCtx, MODEL, result.usage);

  return result;
});

/** The irreversible action, recorded as an audited agent tool call. */
const issueRefund = defineAgentToolCall(
  (ticket: Ticket) => ({
    action: 'agent.refund.issue',
    resource: 'payments_v3',
    agent: { id: 'support-agent', version: AGENT_VERSION, model: MODEL },
    // Tool input and output are hashed onto the span, never attached raw. The
    // hash is what proves which arguments produced which result without
    // shipping a customer's data to your telemetry backend.
    tool: {
      name: 'issue_refund',
      input: { ticket: ticket.id, amount: ticket.amountGbp },
    },
  }),
  () => async (ticket: Ticket) => ({
    refundId: `re_${ticket.id}`,
    amount: ticket.amountGbp,
  }),
);

/** A cheap deterministic check standing in for an LLM judge. */
function judge(result: Draft): { pass: boolean; reason: string } {
  return result.citedPolicy
    ? { pass: true, reason: 'answer cites a policy' }
    : { pass: false, reason: 'answer cites no policy' };
}

/** One draft plus the check that judged it, both on the same step span. */
async function draftAndJudge(messages: string[]) {
  const result = await draft(messages);
  const verdict = judge(result);
  // The verdict is an event on this step's span, so a failing score and the
  // answer that earned it open together.
  recordEvaluationResult(ctx, {
    name: 'cites-policy',
    scoreValue: verdict.pass ? 1 : 0,
    scoreLabel: verdict.pass ? 'pass' : 'fail',
    explanation: verdict.reason,
    responseId: result.responseId,
  });
  return { result, verdict };
}

export const answerTicket = traceWorkflow({
  name: 'answer-refund-ticket',
  workflowId: (ticket: Ticket) => ticket.id,
  version: AGENT_VERSION,
})(() => async (ticket: Ticket) => {
  const retrieve = traceStep({ name: 'retrieve' })(async () => [
    'policy refunds-v4: refunds under \u00a3250 are automatic within 14 days',
  ]);
  const documents = await retrieve();

  const messages = [ticket.question, ...documents];
  let attempt = 1;
  let { result, verdict } = await traceStep({ name: 'draft' })(() =>
    draftAndJudge(messages),
  )();

  if (!verdict.pass) {
    // The retry carries the judge's complaint back as context. Recording what
    // the retry changed is the difference between "it passed on attempt two"
    // and knowing why.
    attempt = 2;
    const retryMessages = [
      ...messages,
      `Rejected: ${verdict.reason}. Redo and cite the policy.`,
    ];
    ({ result, verdict } = await traceStep({
      name: 'draft-retry',
      attributes: {
        'agent.retry.attempt': attempt,
        'agent.retry.reason': verdict.reason,
      },
    })(() => draftAndJudge(retryMessages))());
  }

  if (!verdict.pass) return { status: 'escalated' as const, attempt };

  const refund = await issueRefund(ticket);
  return {
    status: 'refunded' as const,
    attempt,
    refund,
    answer: result.answer,
  };
});
