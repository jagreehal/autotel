/**
 * One OpenTelemetry pipeline, fanned out — all by autotel, no extra OTel libs.
 *
 * The thesis: **instrument once with an autotel package and you see it
 * everywhere** — Langfuse, autotel-devtools, your console — because they're all
 * just consumers of one canonical `gen_ai.*` span stream. Langfuse is a
 * *destination*, not a span source.
 *
 * The trick: Langfuse ingests plain OTLP (its `LangfuseSpanProcessor` is just an
 * `OTLPTraceExporter` pointed at `…/api/public/otel/v1/traces` with a Basic-auth
 * header), and autotel-devtools is an OTLP receiver too. So autotel's *native*
 * `destinations` config fans the same spans to both — no `@langfuse/otel`, no
 * `@opentelemetry/*` exporter packages, no hand-rolled processors.
 *
 *   1. `registerTelemetry(autotelTelemetry(...))` instruments the Vercel AI SDK
 *      once with `autotel-genai`: every `generateText` / `streamText` / `embed`
 *      becomes a canonical `gen_ai.*` span (model, prompt/response, usage, cost,
 *      streaming timing).
 *
 *   2. `init({ destinations: [...] })` sends those spans to Langfuse and/or
 *      autotel-devtools over OTLP, plus a pretty console view locally.
 *
 * Import this module first, before anything that calls the AI SDK.
 */

import 'dotenv/config';
import { trace as otelTrace } from '@opentelemetry/api';
import { registerTelemetry } from 'ai';
import { init } from 'autotel';
import { autotelTelemetry } from 'autotel-genai/observer';

/**
 * Langfuse reads credentials from the environment (see `.env.example`):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASEURL
 */
const langfuseBaseUrl =
  process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com';
export const langfuseEnabled = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
);

/**
 * autotel-devtools is just another OTLP receiver — proof that Langfuse isn't a
 * span *source*, just one consumer. Set `DEVTOOLS=1` and run `npx
 * autotel-devtools` (:4318) to fan the SAME spans into its local GenAI view.
 * (autotel also has a first-class `devtools: true` shorthand — see the README.)
 */
export const devtoolsEnabled = process.env.DEVTOOLS === '1';
const devtoolsEndpoint =
  process.env.DEVTOOLS_ENDPOINT ?? 'http://127.0.0.1:4318';

/**
 * Each destination is plain OTLP. Langfuse authenticates with HTTP Basic
 * (`base64(publicKey:secretKey)`) at its `/api/public/otel` OTLP path — exactly
 * what `LangfuseSpanProcessor` does under the hood, expressed as autotel config.
 */
const tracesOnly: 'traces'[] = ['traces'];
const destinations = [
  langfuseEnabled
    ? {
        endpoint: `${langfuseBaseUrl}/api/public/otel`,
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
          ).toString('base64')}`,
        },
        signals: tracesOnly,
      }
    : undefined,
  devtoolsEnabled
    ? { endpoint: devtoolsEndpoint, signals: tracesOnly }
    : undefined,
].filter((d): d is NonNullable<typeof d> => d != null);

init({
  service: 'example-langfuse',
  // Pretty, hierarchical console output = a zero-infra local view, so the demo
  // always shows the spans. `destinations` fans the same spans out to Langfuse
  // and/or devtools over OTLP — every consumer is just another entry here.
  debug: 'pretty',
  ...(destinations.length > 0 ? { destinations } : {}),
});

// Instrument the AI SDK once. The tracer comes from autotel's global provider,
// so these spans flow through the pipeline above — console + every destination.
// `captureContent: true` records prompts/responses and tool args/results, which
// Langfuse maps to a generation's input/output and devtools shows in its GenAI view.
const tracer = otelTrace.getTracer('example-langfuse');
registerTelemetry(autotelTelemetry({ tracer, captureContent: true }));
