/**
 * Runs the Lambda handler in-process against Bedrock, prints the trace, and
 * checks the Bedrock attributes are on every model call.
 *
 *   AWS_PROFILE=<profile> AWS_REGION=eu-west-1 pnpm --filter @jagreehal/example-bedrock start
 */
import './telemetry.js';
import assert from 'node:assert/strict';
import { shutdown } from 'autotel';
import { handler } from './handler.js';
import { captured } from './telemetry.js';
import { MODEL_ID } from './agent.js';
import { printTrace } from './print-trace.js';

const prompt =
  process.argv.slice(2).join(' ') || "Which of Acme's orders is on hold?";

const context = {
  functionName: 'example-bedrock',
  functionVersion: '$LATEST',
  awsRequestId: `local-${Date.now()}`,
  invokedFunctionArn:
    'arn:aws:lambda:eu-west-1:000000000000:function:example-bedrock',
  memoryLimitInMB: '1024',
  getRemainingTimeInMillis: () => 60_000,
} as never;

console.log(`model: ${MODEL_ID}\nprompt: ${prompt}\n`);
const response = await handler({ prompt }, context);
console.log(`answer: ${response.body}\n`);

const spans = captured.getFinishedSpans();
printTrace(spans);

const chats = spans.filter(
  (s) => s.attributes['gen_ai.operation.name'] === 'chat',
);
assert.ok(chats.length > 0, 'expected at least one chat span');
for (const chat of chats) {
  assert.equal(chat.attributes['gen_ai.provider.name'], 'aws.bedrock');
  assert.equal(typeof chat.attributes['aws.bedrock.stop_reason'], 'string');
  assert.equal(
    typeof chat.attributes['aws.bedrock.guardrail.intervened'],
    'boolean',
  );
  // bedrockCompatibility() strips the inference-profile prefix and ARN.
  assert.doesNotMatch(
    String(chat.attributes['gen_ai.request.model']),
    /^(us|eu|apac|global)\./,
  );
}
assert.ok(
  spans.some((s) => s.name.startsWith('lambda.')),
  'expected the Lambda root span',
);
console.log(`\nok: ${chats.length} chat span(s) carry aws.bedrock.stop_reason`);

await shutdown();
