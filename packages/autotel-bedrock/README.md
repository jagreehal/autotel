# autotel-bedrock

Amazon Bedrock facts for autotel's canonical `gen_ai.*` spans.

`autotel-genai` emits `gen_ai.*` spans for every AI SDK call against Amazon
Bedrock (`gen_ai.provider.name = aws.bedrock`, the model id, token usage, input
and output messages) from the observer alone:

```ts
import { registerTelemetry } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry());
```

This package adds the Bedrock facts that no OpenTelemetry convention covers
and no generic price table knows.

## What this package adds

```ts
import { init } from 'autotel';
import { registerTelemetry } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';
import {
  bedrockCompatibility,
  bedrockProviderAttributes,
  BEDROCK_PRICING,
} from 'autotel-bedrock';

init({
  service: 'payments-bot',
  spanEnrichers: [bedrockCompatibility({ region: 'eu-west-1' })],
});

registerTelemetry(
  autotelTelemetry({
    pricing: BEDROCK_PRICING,
    providerAttributes: bedrockProviderAttributes,
  }),
);
```

### One model, three spellings

Bedrock accepts the same model as a foundation-model id, a cross-region
inference profile, or an inference-profile ARN:

```
anthropic.claude-sonnet-4-5-20250929-v1:0
eu.anthropic.claude-sonnet-4-5-20250929-v1:0
arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0
```

Dashboards group by `gen_ai.request.model` and Datadog / Langfuse price by it,
so a profile or ARN splits one model into several rows and drops the cost
(`cost_estimate_status:skipped_unsupported_model_pricing`). The enricher
rewrites `gen_ai.request.model` / `gen_ai.response.model` to the foundation id
and keeps the rest as their own attributes:

| Attribute                              | Value                                       |
| -------------------------------------- | ------------------------------------------- |
| `gen_ai.request.model`                 | `anthropic.claude-sonnet-4-5-20250929-v1:0` |
| `aws.bedrock.model.id_raw`             | the id as the request spelled it            |
| `aws.bedrock.model.arn`                | the ARN, when one was used                  |
| `aws.bedrock.inference_profile.region` | `eu`, `us`, `global`…                       |
| `aws.bedrock.model.vendor`             | `anthropic`, `amazon`, `meta`, `zai`…       |
| `cloud.provider` / `cloud.region`      | `aws` / the option or `AWS_REGION`          |

Pass `normalizeModel: false` to keep the requested spelling and add the extra
attributes only. Spans from other providers pass through untouched.

Register it under `spanEnrichers`. `spanProcessors` replaces the pipeline
autotel builds, including the destinations you configured.

### Stop reason and guardrails

The AI SDK folds Bedrock's stop reasons into its own (`guardrail_intervened`
and `content_filtered` both become `content-filter`; `malformed_tool_use` and
`model_context_window_exceeded` become `other`), and its lifecycle events omit
the guardrail trace. `bedrockProviderAttributes` records both:

```ts
registerTelemetry(
  autotelTelemetry({
    pricing: BEDROCK_PRICING,
    providerAttributes: bedrockProviderAttributes,
  }),
);
```

| Attribute                          | Value                                                     |
| ---------------------------------- | --------------------------------------------------------- |
| `aws.bedrock.stop_reason`          | `end_turn`, `max_tokens`, `guardrail_intervened`…         |
| `aws.bedrock.guardrail.intervened` | `true` when the guardrail stopped generation              |
| `aws.bedrock.guardrail.id`         | from the trace, so set `guardrailConfig.trace: 'enabled'` |

`gen_ai.response.finish_reasons` keeps the AI SDK's unified value, so a
dashboard built on it keeps working. An intervention is a policy outcome: the
span's status stays unset, and `guardrail.intervened / total` is one query.

### Bedrock-only pricing

`BEDROCK_PRICING` is a table for `autotelTelemetry({ pricing })` covering the
models that exist only behind Bedrock: Nova, Llama, Mistral, DeepSeek, GLM.
Bedrock bills Anthropic models at Anthropic's rates, and `autotel-genai`
prices those by family, so they are not listed here.

Keys match the way `autotel-genai/cost` resolves ids (exact, then prefix, tried
again after each region and vendor prefix is peeled), so
`eu.amazon.nova-pro-v1:0` resolves via `amazon.nova-pro`.

The prices are list prices at the time of writing, a convenience default rather
than a billing source of truth. Spread and override what you use:

```ts
autotelTelemetry({
  pricing: {
    ...BEDROCK_PRICING,
    'zai.glm-4.7-flash': { inputPer1M: 0.5, outputPer1M: 2 },
  },
});
```

Runnable example: [`apps/example-bedrock`](../../apps/example-bedrock), a Lambda handler around an AI SDK tool-loop agent, run in-process against Bedrock.

## Already covered elsewhere

| Signal                                   | Comes from                             |
| ---------------------------------------- | -------------------------------------- |
| `gen_ai.provider.name = aws.bedrock`     | `autotel-genai` provider normalisation |
| Anthropic model cost on Bedrock          | `autotel-genai/cost` family pricing    |
| Lambda spans, cold starts, X-Ray context | `autotel-aws/lambda`                   |
| Datadog / Langfuse ingestion             | `autotel-backends`, `autotel-langfuse` |
