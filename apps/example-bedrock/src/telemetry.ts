/**
 * Imported first: `init()` has to run before anything creates a span.
 *
 * Spans go to `OTEL_EXPORTER_OTLP_ENDPOINT` when it is set (autotel reads it)
 * and, always, to an in-memory exporter this example prints and checks.
 */
import { init } from 'autotel';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import {
  bedrockCompatibility,
  bedrockProviderAttributes,
} from 'autotel-bedrock';
import { autotelTelemetry } from 'autotel-genai/observer';
import { registerTelemetry } from 'ai';

export const captured = new InMemorySpanExporter();

init({
  service: 'example-bedrock',
  spanExporters: [captured],
  // Foundation-model id behind an inference profile or ARN, plus
  // cloud.region from AWS_REGION.
  spanEnrichers: [bedrockCompatibility()],
});

// One gen_ai.* span per AI SDK call: the agent, each model call, each tool.
// providerAttributes adds Bedrock's own stop reason and guardrail outcome.
// autotel ships no prices: these are yours, dated so a stale one shows up.
registerTelemetry(
  autotelTelemetry({
    captureContent: true,
    pricing: {
      // The default MODEL_ID. Check https://aws.amazon.com/bedrock/pricing/
      // for your region and add a row for any model you switch to.
      'claude-haiku-4-5': {
        inputPer1M: 1,
        outputPer1M: 5,
        cachedInputPer1M: 0.1,
        cacheWritePer1M: 1.25,
        asOf: '2026-11-14',
        source: 'Anthropic list price',
      },
    },
    providerAttributes: bedrockProviderAttributes,
  }),
);
