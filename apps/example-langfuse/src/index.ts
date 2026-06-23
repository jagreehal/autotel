/**
 * autotel + Langfuse — instrument once, observe in both.
 *
 * `./instrumentation` wires autotel's `init()` pipeline so every `gen_ai.*` span
 * autotel-genai produces is exported to the console *and* to Langfuse. The
 * business code below never imports anything Langfuse-specific except
 * `propagateAttributes` (which only adds trace grouping metadata) — the spans
 * themselves come straight from `autotel-genai`.
 *
 * Prereqs: `ollama serve` running, `ollama pull llama3.2`, and (for Demo 4)
 * `ollama pull nomic-embed-text`. To send to Langfuse, set LANGFUSE_PUBLIC_KEY /
 * LANGFUSE_SECRET_KEY / LANGFUSE_BASEURL (see `.env.example`).
 */

import {
  devtoolsEnabled,
  langfuseEnabled,
} from './instrumentation.js'; // side-effect: pipeline + telemetry, must be first

import { propagateAttributes } from '@langfuse/tracing';
import { embed, stepCountIs, tool } from 'ai';
import { generateText, ollama, streamText } from 'ai-sdk-ollama';
import { shutdown } from 'autotel';
import { z } from 'zod';

// granite4 by default — it drives the Demo 2 tool loop reliably, where
// llama3.2 tends to mangle tool arguments.
const MODEL = process.env.OLLAMA_MODEL ?? 'granite4';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

const model = ollama(MODEL);

const multiply = tool({
  description: 'Multiply two numbers and return the product.',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => a * b,
});

async function main(): Promise<void> {
  banner();

  // --- Demo 1: plain generateText ------------------------------------------
  // autotel-genai emits `invoke_agent › chat` with token usage + cost. Langfuse
  // maps the `chat` span to a generation. Nothing here knows about Langfuse.
  console.log(`\n=== Demo 1 · generateText (${MODEL}) ===`);
  const explain = await generateText({
    model,
    prompt: 'In one sentence, what is OpenTelemetry?',
    telemetry: { functionId: 'explain' },
  });
  console.log('model:', oneLine(explain.text));

  // --- Demo 2: propagateAttributes — group the trace in Langfuse ------------
  // The only Langfuse-aware line in the whole demo. It attaches trace name,
  // user, session and tags to every span produced inside the callback, so the
  // run shows up as a named, user-scoped trace in the Langfuse UI. The model
  // call is still a stock autotel-genai tool loop.
  console.log(`\n=== Demo 2 · generateText + tool, wrapped in propagateAttributes ===`);
  const agent = await propagateAttributes(
    {
      traceName: 'support-chat',
      userId: 'user-123',
      sessionId: 'session-456',
      tags: ['example', 'chat'],
      metadata: { route: 'support-chat' },
    },
    () =>
      generateText({
        model,
        prompt:
          'What is 23 multiplied by 19? Use the multiply tool, then state the number.',
        tools: { multiply },
        stopWhen: stepCountIs(5),
        telemetry: { functionId: 'agent' },
      }),
  );
  console.log('agent:', oneLine(agent.text));

  // --- Demo 3: streamText — adds streaming timing --------------------------
  // autotel-genai records `time_to_first_chunk` / `output_tokens_per_second` on
  // the `chat` span; both ride along to Langfuse as generation metadata.
  console.log(`\n=== Demo 3 · streamText (streaming timing) ===`);
  const stream = await streamText({
    model,
    prompt: 'In two sentences, why is observability useful?',
    telemetry: { functionId: 'stream-story' },
  });
  let streamed = '';
  for await (const delta of stream.textStream) streamed += delta;
  console.log('model:', oneLine(streamed));

  // --- Demo 4: embed — a standalone embeddings span ------------------------
  console.log(`\n=== Demo 4 · embed (${EMBED_MODEL}) ===`);
  try {
    const { embedding } = await embed({
      model: ollama.embedding(EMBED_MODEL),
      value: 'Write once, observe everywhere.',
    });
    console.log(`embedding: ${embedding.length} dims`);
  } catch (error) {
    console.log(
      `  (skipped — ${EMBED_MODEL} not available: ${errorMessage(error)})\n` +
        `  pull it with: ollama pull ${EMBED_MODEL}`,
    );
  }

  // autotel's shutdown flushes the OTLP batch exporters and closes the provider.
  await shutdown();

  const sinks = [
    langfuseEnabled &&
      `Langfuse (${process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com'})`,
    devtoolsEnabled && 'autotel-devtools (http://127.0.0.1:4318)',
  ].filter(Boolean);

  console.log(
    sinks.length > 0
      ? `\n✓ Same gen_ai.* spans sent to: ${sinks.join(' + ')}. Open them to see the traces.`
      : `\n✓ Done. No OTLP destinations enabled — spans printed above only. Set Langfuse keys (.env.example) and/or DEVTOOLS=1 to fan them out.`,
  );
}

function banner(): void {
  const sinks = [
    'console',
    langfuseEnabled && 'Langfuse',
    devtoolsEnabled && 'devtools',
  ].filter(Boolean);
  console.log(
    `Fan-out destinations for the same gen_ai.* spans: ${sinks.join(' + ')}.`,
  );
}

function oneLine(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}…` : collapsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConnectionError(error: unknown): boolean {
  return /ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(
    errorMessage(error),
  );
}

main().catch((error) => {
  if (isConnectionError(error)) {
    console.error(
      `\nCould not reach Ollama.\n` +
        `Start it with:  ollama serve\n` +
        `Pull the model: ollama pull ${MODEL}`,
    );
  } else {
    console.error('\nExample failed:', error);
  }
  process.exit(1);
});
