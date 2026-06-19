/**
 * LangChain / LangGraph + Ollama, captured as canonical `gen_ai.*` spans.
 *
 * One `createLangChainObserver` handler bridges every LangChain callback into
 * `createGenAiObserver`, which builds the span tree. An in-memory exporter then
 * lets us print what was captured — proving the glue works end to end against a
 * real local model.
 *
 * Prereqs: `ollama serve` running, and `ollama pull llama3.2`.
 */

import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  createGenAiObserver,
  createLangChainObserver,
} from 'autotel-genai/observer';
import { z } from 'zod';
import { printTrace } from './print-trace.js';

const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';
const BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

async function main(): Promise<void> {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('langchain-observer-example');

  // `exportContent: (e) => e` opts in to capturing prompts / tool args / results
  // so they show up on the spans. Omit it (the default) to keep content off.
  const observe = createGenAiObserver({ tracer, exportContent: (event) => event });
  const handler = createLangChainObserver(observe);

  const multiply = tool(({ a, b }) => String(a * b), {
    name: 'multiply',
    description: 'Multiply two numbers and return the product.',
    schema: z.object({ a: z.number(), b: z.number() }),
  });

  const llm = new ChatOllama({ model: MODEL, temperature: 0, baseUrl: BASE_URL });

  // --- Demo 1: a plain chat — a single `chat` span carrying token usage ------
  console.log(`\n=== Demo 1 · ChatOllama.invoke (${MODEL}) ===`);
  const chat = await llm.invoke('In one sentence, what is OpenTelemetry?', {
    callbacks: [handler],
  });
  console.log('model:', oneLine(chat.content));
  printTrace(exporter.getFinishedSpans());

  // --- Demo 2: a ReAct agent with a tool — invoke_agent › chat › execute_tool
  exporter.reset();
  console.log(`\n=== Demo 2 · LangGraph ReAct agent + multiply tool ===`);
  const agent = createReactAgent({ llm, tools: [multiply] });
  const result = await agent.invoke(
    {
      messages: [
        new HumanMessage(
          'What is 23 multiplied by 19? Use the multiply tool, then state the number.',
        ),
      ],
    },
    { callbacks: [handler] },
  );
  console.log('agent:', oneLine(result.messages.at(-1)?.content));
  printTrace(exporter.getFinishedSpans());

  // --- Demo 3: a direct tool call — a deterministic `execute_tool` span ------
  // Small local models call tools unreliably, so invoke one through LangChain
  // directly to prove tool capture (name, arguments, result) regardless.
  exporter.reset();
  console.log('\n=== Demo 3 · direct tool call (deterministic capture) ===');
  const product = await multiply.invoke(
    { a: 23, b: 19 },
    { callbacks: [handler] },
  );
  console.log('tool returned:', product);
  printTrace(exporter.getFinishedSpans());

  await provider.shutdown();
}

function oneLine(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}…` : collapsed;
}

function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(message);
}

main().catch((error) => {
  if (isConnectionError(error)) {
    console.error(
      `\nCould not reach Ollama at ${BASE_URL}.\n` +
        `Start it with:  ollama serve\n` +
        `Pull the model: ollama pull ${MODEL}`,
    );
  } else {
    console.error('\nExample failed:', error);
  }
  process.exit(1);
});
