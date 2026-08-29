/**
 * Run the agent, then hand only its telemetry to a reviewer and ask whether
 * the decision can be reconstructed. Run the same work with log-shaped
 * instrumentation and ask again.
 *
 * The assertions at the end are the essay's test, executed: the traced run
 * answers every question, the logged run answers almost none.
 */
import assert from 'node:assert/strict';
import { init, flush, trace } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import { MockEventSubscriber } from 'autotel-subscribers/testing';
import { review, unanswered, type RecordedEvent } from './reviewer';
import { answerTicket, type Ticket } from './agent';

const spanCollector = createMemoryExporter();
// Evaluation results are events, and events reach a backend through a
// subscriber. They carry the trace and span id of the step that emitted them,
// which is how the reviewer joins them back to the run.
const eventSubscriber = new MockEventSubscriber();

init({
  service: 'support-agent',
  sampling: 'development',
  spanExporters: [spanCollector],
  subscribers: [eventSubscriber],
});

const ticket: Ticket = {
  id: 'tkt-4471',
  question: 'Can I get a refund on my £240 order from last week?',
  amountGbp: 240,
};

/** The same work, instrumented the way most agent code is: a span and prose. */
const loggedRun = trace('answer-refund-ticket-logged', async (t: Ticket) => {
  logs.push(`[info] answering ${t.id}`);
  logs.push('[info] calling model');
  logs.push('[warn] first answer rejected, retrying');
  logs.push(`[info] refund issued for £${t.amountGbp}`);
  return { status: 'refunded' as const };
});
const logs: string[] = [];

async function main() {
  const outcome = await answerTicket(ticket);
  await loggedRun(ticket);
  await flush();

  const events: RecordedEvent[] = eventSubscriber.events.map((e) => ({
    name: e.name,
    attributes: e.attributes ?? {},
  }));

  const spans = spanCollector.spans();
  const loggedTraceId = spans.find(
    (s) => s.name === 'answer-refund-ticket-logged',
  )?.traceId;
  const traced = spans.filter((s) => s.traceId !== loggedTraceId);
  const logged = spans.filter((s) => s.traceId === loggedTraceId);

  console.log(
    `\nAgent outcome: ${outcome.status} on attempt ${outcome.attempt}\n`,
  );
  console.log(
    `Reviewing ${traced.length} spans and ${events.length} events.\n`,
  );

  const answers = review(traced, events);
  for (const { question, answer } of answers) {
    console.log(`  ${question}`);
    console.log(`    ${answer ?? 'NO ANSWER IN THE TELEMETRY'}\n`);
  }

  const loggedAnswers = review(logged, []);
  console.log(
    `The same work with ${logs.length} log lines and one span answers ` +
      `${loggedAnswers.length - unanswered(loggedAnswers).length} of ` +
      `${loggedAnswers.length} questions.\n`,
  );

  assert.deepEqual(
    unanswered(answers).map((q) => q.question),
    [],
    'the traced run should answer every question a reviewer asks',
  );
  assert.ok(
    unanswered(loggedAnswers).length >= loggedAnswers.length - 1,
    'the log-shaped run should answer almost nothing',
  );

  // The retry is on the trace with its cost, which is the part a summary
  // metric loses: two calls were paid for, not one.
  const llmSpans = traced.filter((s) => s.attributes['gen_ai.request.model']);
  assert.equal(llmSpans.length, 2, 'both model calls should be on the trace');
  assert.ok(
    llmSpans.every((s) => Number(s.attributes['gen_ai.usage.cost.usd']) > 0),
    'every model call should carry its estimated cost',
  );

  console.log(
    'Assertions passed: the trace reconstructs the decision, the logs do not.',
  );
}

await main();
