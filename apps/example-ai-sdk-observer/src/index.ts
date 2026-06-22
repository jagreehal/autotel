/**
 * Vercel AI SDK + Ollama, captured as canonical `gen_ai.*` spans.
 *
 * `registerTelemetry(autotelTelemetry())` registers autotel-genai as an AI SDK
 * `Telemetry` integration once. Every `generateText` / `streamText` / `embed`
 * call then streams an `invoke_agent › chat › execute_tool` span tree — live,
 * with token usage, **cost**, and **streaming timing** — to an in-memory
 * exporter we print, proving the integration works end to end against a real
 * local model.
 *
 * Uses `ai-sdk-ollama`'s `generateText` / `streamText` (enhanced Ollama tool
 * reliability) with the `ollama` provider; they wrap the AI SDK's own functions,
 * so the telemetry lifecycle — and thus our integration — fires transparently.
 *
 * Prereqs: `ollama serve` running, `ollama pull llama3.2`, and (for Demo 4)
 * `ollama pull nomic-embed-text`.
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { embed, registerTelemetry, stepCountIs, tool } from 'ai';
import { generateText, ollama, streamText } from 'ai-sdk-ollama';
import { autotelTelemetry } from 'autotel-genai/observer';
import { z } from 'zod';
import { printTrace } from './print-trace.js';

const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const tracer = provider.getTracer('ai-sdk-observer-example');

// Register once. `captureContent: true` opts in to recording prompts, responses
// and tool args/results on the spans; omit it (the default) to keep content off.
registerTelemetry(autotelTelemetry({ tracer, captureContent: true }));

const model = ollama(MODEL);

const multiply = tool({
  description: 'Multiply two numbers and return the product.',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => a * b,
});

async function main(): Promise<void> {
  // --- Demo 1: a plain generateText — invoke_agent › chat with usage + cost --
  console.log(`\n=== Demo 1 · generateText (${MODEL}) ===`);
  const explain = await generateText({
    model,
    prompt: 'In one sentence, what is OpenTelemetry?',
    telemetry: { functionId: 'explain' },
  });
  console.log('model:', oneLine(explain.text));
  printTrace(exporter.getFinishedSpans());

  // --- Demo 2: a tool loop — invoke_agent › chat › execute_tool › chat -------
  exporter.reset();
  console.log(`\n=== Demo 2 · generateText + multiply tool ===`);
  const agent = await generateText({
    model,
    prompt:
      'What is 23 multiplied by 19? Use the multiply tool, then state the number.',
    tools: { multiply },
    stopWhen: stepCountIs(5),
    telemetry: { functionId: 'agent' },
  });
  console.log('agent:', oneLine(agent.text));
  printTrace(exporter.getFinishedSpans());

  // --- Demo 3: streamText — adds streaming timing (ttfc, tokens/sec) ---------
  exporter.reset();
  console.log(`\n=== Demo 3 · streamText (streaming timing) ===`);
  const stream = await streamText({
    model,
    prompt: 'In two sentences, why is observability useful?',
    telemetry: { functionId: 'stream-story' },
  });
  let streamed = '';
  for await (const delta of stream.textStream) streamed += delta;
  console.log('model:', oneLine(streamed));
  printTrace(exporter.getFinishedSpans());

  // --- Demo 4: embed — a standalone embeddings span with token usage ---------
  exporter.reset();
  console.log(`\n=== Demo 4 · embed (${EMBED_MODEL}) ===`);
  try {
    const { embedding } = await embed({
      model: ollama.embedding(EMBED_MODEL),
      value: 'Write once, observe everywhere.',
    });
    console.log(`embedding: ${embedding.length} dims`);
    printTrace(exporter.getFinishedSpans());
  } catch (error) {
    console.log(
      `  (skipped — ${EMBED_MODEL} not available: ${errorMessage(error)})\n` +
        `  pull it with: ollama pull ${EMBED_MODEL}`,
    );
  }

  await provider.shutdown();
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
