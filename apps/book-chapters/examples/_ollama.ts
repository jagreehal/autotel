// Shared setup for the two chapters that call a real model.
//
// The runner skips files starting with `_`, so this is a helper rather than a
// chapter. Chapters 21 and 22 need the same two things: a local model, and a
// way to say "no model here" without inventing numbers that look like evidence.

import { registerTelemetry } from 'ai';
import { ollama } from 'ai-sdk-ollama';
import { init } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { getAutotelTracer } from 'autotel/tracer-provider';
import { autotelTelemetry } from 'autotel-genai/observer';

export const OLLAMA_URL = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';

/** The model when Ollama answers and has it pulled, otherwise undefined. */
export async function reachOllama() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return undefined;
    // SAFETY: /api/tags is Ollama's documented endpoint and this is the shape it
    // answers with; only `name` is read, and the request is bounded by a timeout.
    const { models } = (await response.json()) as {
      models: Array<{ name: string }>;
    };
    const pulled = models.some(
      (entry) =>
        entry.name === OLLAMA_MODEL ||
        entry.name.split(':')[0] === OLLAMA_MODEL.split(':')[0],
    );
    return pulled ? ollama(OLLAMA_MODEL) : undefined;
  } catch {
    return undefined;
  }
}

export function skip(chapter: string): void {
  console.log(`${chapter} skipped: no ${OLLAMA_MODEL} at ${OLLAMA_URL}`);
  console.log(`  to run it: ollama serve, then ollama pull ${OLLAMA_MODEL}`);
}

/**
 * One registration turns every later generateText and streamText call into a
 * canonical `gen_ai.*` span tree. Nothing below hand-writes a token count.
 */
export function collectGenAiSpans(service: string): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  init({ service, spanProcessors: [new SimpleSpanProcessor(exporter)] });
  registerTelemetry(autotelTelemetry({ tracer: getAutotelTracer(service) }));
  return exporter;
}
