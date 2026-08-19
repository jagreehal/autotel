/**
 * autotel + Langfuse — instrument once, observe in both.
 *
 * `./instrumentation` wires autotel's `init()` pipeline so every `gen_ai.*` span
 * autotel-genai produces is exported to the console *and* to Langfuse. The
 * business code below imports nothing from Langfuse at all: the spans come from
 * `autotel-genai`, and the few fields Langfuse keeps in its own columns are
 * filled in by `langfuseCompatibility()` in `./instrumentation`.
 *
 * Prereqs: `ollama serve` running, `ollama pull llama3.2`, and (for Demo 4)
 * `ollama pull nomic-embed-text`. To send to Langfuse, set LANGFUSE_PUBLIC_KEY /
 * LANGFUSE_SECRET_KEY / LANGFUSE_BASEURL (see `.env.example`).
 */

import { devtoolsEnabled, langfuseEnabled } from './instrumentation.js'; // side-effect: pipeline + telemetry, must be first

import { embed, stepCountIs, tool } from 'ai';
import { generateText, ollama, streamText } from 'ai-sdk-ollama';
import {
  getActiveSpan,
  setSession,
  setUser,
  shutdown,
  withTracing,
} from 'autotel';
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

  // --- Demo 2: user, session and tags, with no Langfuse SDK ---------------
  // Langfuse reads `user.id` and `session.id` under those standard names, which
  // is exactly what autotel's `setUser` / `setSession` write. The trace name and
  // tags come from `langfuseCompatibility()` in ./instrumentation. Nothing in
  // this file imports a Langfuse package.
  console.log(
    `\n=== Demo 2 · generateText + tool, scoped to a user and session ===`,
  );
  const agent = await withTracing({ name: 'support-chat' })(() => async () => {
    const span = getActiveSpan();
    if (span) {
      setUser(span, { id: 'user-123' });
      setSession(span, { id: 'session-456' });
    }
    return generateText({
      model,
      prompt:
        'What is 23 multiplied by 19? Use the multiply tool, then state the number.',
      tools: { multiply },
      stopWhen: stepCountIs(5),
      telemetry: { functionId: 'agent' },
    });
  })();
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

/** What a model message carries: text, or the structured parts the SDK returns. */
type MessageContent =
  | string
  | number
  | boolean
  | null
  | Array<MessageContent>
  | { [key: string]: MessageContent };

function oneLine(content: MessageContent): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}…` : collapsed;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isConnectionError(cause: unknown): boolean {
  return /ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(
    errorMessage(cause),
  );
}

main().catch(async (error) => {
  if (isConnectionError(error)) {
    console.error(
      `\nCould not reach Ollama.\n` +
        `Start it with:  ollama serve\n` +
        `Pull the model: ollama pull ${MODEL}`,
    );
  } else {
    console.error('\nExample failed:', error);
  }
  await shutdown().catch(() => undefined);
  process.exitCode = 1;
});
