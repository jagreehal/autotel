/**
 * Imported first: `init()` has to run before anything creates a span.
 *
 * Spans go to `OTEL_EXPORTER_OTLP_ENDPOINT` when it is set (autotel reads it)
 * and, always, to an in-memory exporter this example prints and checks.
 */
import { init } from 'autotel';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  BEDROCK_PRICING,
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
registerTelemetry(
  autotelTelemetry({
    captureContent: true,
    pricing: BEDROCK_PRICING,
    providerAttributes: bedrockProviderAttributes,
  }),
);
