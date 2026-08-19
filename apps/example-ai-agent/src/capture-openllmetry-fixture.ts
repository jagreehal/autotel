/**
 * Capture a real OpenLLMetry OTLP span as a fixture for autotel-devtools.
 *
 * Makes one cheap gpt-4o-mini call (≈ $0.0001 / call), captures the spans
 * via an in-memory exporter, transforms them into the SpanData shape the
 * devtools widget consumes, and writes the GenAI ones to:
 *   ../../packages/autotel-devtools/src/widget/genai/__fixtures__/openllmetry-openai-real.json
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... tsx src/capture-openllmetry-fixture.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import OpenAI from 'openai';
import 'dotenv/config';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  here,
  '../../../packages/autotel-devtools/src/widget/genai/__fixtures__/openllmetry-openai-real.json',
);

/** What OpenTelemetry lets a span attribute hold. */
type SpanAttributes = Record<
  string,
  | string
  | number
  | boolean
  | Array<string | number | boolean | null>
  | undefined
>;

interface ReadableSpan {
  spanContext(): { traceId: string; spanId: string };
  parentSpanContext?: { spanId: string };
  parentSpanId?: string;
  name: string;
  kind: number;
  startTime: [number, number];
  endTime: [number, number];
  attributes: SpanAttributes;
  status: { code: number; message?: string };
  events?: Array<{
    name: string;
    time: [number, number];
    attributes?: SpanAttributes;
  }>;
}

function hrTimeToNs(t: [number, number]): number {
  return t[0] * 1_000_000_000 + t[1];
}

const KIND_NAMES = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];

/** OpenTelemetry status codes, keyed by the numeric code a span carries. */
const STATUS_NAMES = new Map<number, 'OK' | 'ERROR' | 'UNSET'>([
  [0, 'UNSET'],
  [1, 'OK'],
  [2, 'ERROR'],
]);

function toSpanData(span: ReadableSpan) {
  const ctx = span.spanContext();
  const startNs = hrTimeToNs(span.startTime);
  const endNs = hrTimeToNs(span.endTime);
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? span.parentSpanId,
    name: span.name,
    kind: KIND_NAMES[span.kind] ?? 'INTERNAL',
    startTime: startNs,
    endTime: endNs,
    duration: endNs - startNs,
    attributes: span.attributes,
    status: {
      code: STATUS_NAMES.get(span.status.code) ?? 'UNSET',
      message: span.status.message,
    },
    events: (span.events ?? []).map((ev) => ({
      name: ev.name,
      timestamp: hrTimeToNs(ev.time),
      attributes: ev.attributes,
    })),
  };
}

const exporter = new InMemorySpanExporter();

init({
  service: 'autotel-devtools-fixture-capture',
  environment: 'fixture',
  spanExporter: exporter,
  openllmetry: {
    enabled: true,
    options: {
      disableBatch: true,
      baseUrl: '',
      instrumentModules: { openAI: OpenAI },
    },
  },
});

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set — refusing to make a call.');
    process.exitCode = 2;
    return;
  }

  const openai = new OpenAI();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 32,
    messages: [
      { role: 'system', content: 'Reply with a single short word.' },
      { role: 'user', content: 'Greet me.' },
    ],
  });
  console.log('response:', response.choices[0]?.message?.content);

  await shutdown();

  // SAFETY: the in-memory exporter and this file resolve @opentelemetry/sdk-trace-base
  // through different dependency paths, so the ReadableSpan they each name is the same
  // shape under two identities. Only the fields toSpanData reads are touched.
  const spans = exporter.getFinishedSpans() as ReadableSpan[];
  const genAiSpans = spans
    .map(toSpanData)
    .filter((s) =>
      Object.keys(s.attributes ?? {}).some(
        (k) => k.startsWith('gen_ai.') || k.startsWith('llm.'),
      ),
    );

  if (genAiSpans.length === 0) {
    console.error(
      `No GenAI spans captured. Captured ${spans.length} total spans.`,
    );
    process.exitCode = 1;
    return;
  }

  const fixture =
    genAiSpans.length === 1
      ? genAiSpans[0]
      : { _multi: true, spans: genAiSpans };

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${genAiSpans.length} GenAI span(s) → ${FIXTURE_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
