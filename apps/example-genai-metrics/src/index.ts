/**
 * Generates agent traffic with canonical `gen_ai.*` spans.
 *
 * The app records no metrics. The collector derives them from these spans with
 * the signal_to_metrics connector, so cost, latency, tokens and tool usage
 * reach Grafana without a single instrument in application code.
 *
 * Run: pnpm start
 */

import { init, span, getActiveTraceContext, flush, shutdown } from 'autotel';
import {
  traceGenAI,
  recordGenAiResponse,
  recordGenAiUsage,
  recordStreamTiming,
  GEN_AI_OPERATION,
} from 'autotel-genai';

const CONVERSATIONS = 40;

const MODELS = [
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'anthropic', model: 'claude-sonnet-4' },
] as const;

const TOOLS = ['search_docs', 'query_metrics', 'open_dashboard'] as const;

init({
  service: 'support-agent',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  sampling: 'development',
});

/** One LLM call: usage, cost, and streaming timings on a canonical chat span. */
function chat(provider: string, model: string) {
  return traceGenAI({
    provider,
    model,
    operation: GEN_AI_OPERATION.CHAT,
    temperature: 0.2,
    // traceGenAI emits these metrics itself. Switched off here so the numbers
    // come from the collector alone, which is the point of this example and
    // what a service written in another language would rely on.
    metrics: false,
  })((ctx) => async (turn: number) => {
    const timeToFirstChunk = 0.2 + Math.random() * 0.6;
    await delay(timeToFirstChunk * 1000);

    // Every eighth call trips the provider.
    if (turn % 8 === 0) {
      throw new Error(`${provider} returned 529 overloaded`);
    }

    const inputTokens = 400 + Math.floor(Math.random() * 1200);
    const outputTokens = 80 + Math.floor(Math.random() * 400);
    const timeToFinish = timeToFirstChunk + outputTokens / 90;
    await delay((timeToFinish - timeToFirstChunk) * 1000);

    recordGenAiResponse(ctx, {
      model,
      id: `resp-${turn}`,
      finishReasons: ['stop'],
    });
    // recordGenAiUsage prices the call itself, so this one line writes
    // gen_ai.usage.input_tokens, output_tokens and cost.usd. Pass
    // `{ recordCost: false }` when a provider gives you the real figure and an
    // estimate would be wrong.
    recordGenAiUsage(ctx, model, { inputTokens, outputTokens });
    recordStreamTiming(ctx, {
      timeToFirstChunk,
      timeToFinish,
      outputTokensPerSecond: outputTokens / timeToFinish,
      chunkCount: Math.ceil(outputTokens / 12),
    });

    return outputTokens;
  });
}

/** One tool call, as a canonical execute_tool span. */
function callTool(name: string) {
  return traceGenAI({
    operation: GEN_AI_OPERATION.EXECUTE_TOOL,
    tool: { name, type: 'function' },
    metrics: false,
  })((ctx) => async () => {
    await delay(20 + Math.random() * 180);
    if (name === 'query_metrics' && Math.random() > 0.85) {
      throw new Error('query_metrics timed out');
    }
    ctx.setAttribute(
      'gen_ai.tool.call.id',
      `call-${Math.floor(performance.now())}`,
    );
  });
}

async function conversation(n: number) {
  const { provider, model } = MODELS[n % MODELS.length]!;

  return span({ name: `invoke_agent support-agent` }, async (ctx) => {
    ctx.setAttribute('gen_ai.operation.name', GEN_AI_OPERATION.INVOKE_AGENT);
    ctx.setAttribute('gen_ai.agent.name', 'support-agent');
    ctx.setAttribute('gen_ai.conversation.id', `conv-${n}`);
    ctx.setAttribute('gen_ai.provider.name', provider);

    await chat(provider, model)(n);

    const tool = TOOLS[n % TOOLS.length]!;
    try {
      await callTool(tool)();
    } catch {
      getActiveTraceContext()?.setAttribute('gen_ai.tool.failed', true);
    }

    // Two thirds of conversations take a second turn after the tool result.
    if (n % 3 !== 0) {
      await chat(provider, model)(n + 1);
    }
  });
}

async function main() {
  console.log(`\nRunning ${CONVERSATIONS} agent conversations\n`);

  let failed = 0;
  for (let n = 1; n <= CONVERSATIONS; n++) {
    try {
      await conversation(n);
    } catch {
      failed++;
    }
  }

  await flush();
  await shutdown();

  console.log(`Done. ${CONVERSATIONS - failed} completed, ${failed} failed.\n`);
  console.log('The collector derived these from the spans alone:');
  console.log(
    '  gen_ai.client.operation.duration   by operation, model, error.type',
  );
  console.log(
    '  gen_ai.client.token.usage          split by gen_ai.token.type',
  );
  console.log('  gen_ai.client.cost.usd             estimated spend by model');
  console.log('  gen_ai.client.time_to_first_chunk  streaming latency');
  console.log('  gen_ai.client.tool.calls           per tool name\n');
  console.log('Grafana:     http://localhost:3000');
  console.log('Prometheus:  http://localhost:9090\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
