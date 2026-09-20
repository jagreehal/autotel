---
name: autotel-bedrock
description: >
  Use this skill when an application calls Amazon Bedrock through the AI SDK and its `gen_ai.*` spans need the Bedrock facts no OpenTelemetry convention carries: the foundation-model id behind an inference profile or ARN (`bedrockCompatibility()`), Bedrock's own stop reason and guardrail outcome (`bedrockProviderAttributes`), and prices for Bedrock-only models (`BEDROCK_PRICING`). Also covers what `autotel-genai` already records, so nothing gets mapped twice.
---

# autotel-bedrock

`autotel-genai` records the canonical span for every AI SDK call against Bedrock: `gen_ai.provider.name = aws.bedrock`, the model id as requested, token usage, finish reason, streaming timing, and messages when content capture is on. This package adds three things on top.

```bash
npm install autotel autotel-genai autotel-bedrock
```

## Setup

```typescript
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
  spanEnrichers: [bedrockCompatibility({ region: process.env.AWS_REGION })],
});

registerTelemetry(
  autotelTelemetry({
    pricing: BEDROCK_PRICING,
    providerAttributes: bedrockProviderAttributes,
  }),
);
```

Register the enricher under `spanEnrichers`. `spanProcessors` replaces the pipeline autotel builds, including the destinations you configured.

## Already recorded by autotel-genai

Check before adding a mapping:

| Signal                            | Attribute                                                               |
| --------------------------------- | ----------------------------------------------------------------------- |
| Provider, operation, model        | `gen_ai.provider.name`, `gen_ai.operation.name`, `gen_ai.request.model` |
| Tokens, cache reads, cost         | `gen_ai.usage.*`, `gen_ai.usage.cost.usd`                               |
| Unified finish reason             | `gen_ai.response.finish_reasons`                                        |
| AWS request id                    | `gen_ai.response.id` (from `x-amzn-requestid`)                          |
| Time to first chunk, chunk timing | `gen_ai.response.time_to_first_chunk`, client metrics                   |
| Prompt name and version           | `gen_ai.prompt.name` / `gen_ai.prompt.version`                          |
| Tool calls as child spans         | `execute_tool <name>` under the `chat` span                             |

## Core Patterns

### One model, three spellings

Bedrock accepts `anthropic.claude-sonnet-4-5-20250929-v1:0`, `eu.anthropic.claude-sonnet-4-5-20250929-v1:0` and the inference-profile ARN for the same model. Dashboards group by `gen_ai.request.model` and Datadog or Langfuse price by it, so a profile or ARN splits one model into several rows and drops the cost. `bedrockCompatibility()` rewrites `gen_ai.request.model` / `gen_ai.response.model` to the foundation id and keeps the rest:

| Attribute                              | Value                                 |
| -------------------------------------- | ------------------------------------- |
| `aws.bedrock.model.id_raw`             | the id as the request spelled it      |
| `aws.bedrock.model.arn`                | the ARN, when one was used            |
| `aws.bedrock.inference_profile.region` | `eu`, `us`, `global`…                 |
| `aws.bedrock.model.vendor`             | `anthropic`, `amazon`, `meta`, `zai`… |
| `cloud.provider` / `cloud.region`      | `aws` / the option or `AWS_REGION`    |

`normalizeModel: false` keeps the requested spelling and adds the extra attributes only.

### Stop reason and guardrails

The AI SDK folds Bedrock's stop reasons into its own (`guardrail_intervened` and `content_filtered` both become `content-filter`; `malformed_tool_use` becomes `other`) and its lifecycle events omit the guardrail trace. `bedrockProviderAttributes` reads the model call's result, or its stream's `finish` part, and records:

| Attribute                          | Value                                                         |
| ---------------------------------- | ------------------------------------------------------------- |
| `aws.bedrock.stop_reason`          | `end_turn`, `tool_use`, `max_tokens`, `guardrail_intervened`… |
| `aws.bedrock.guardrail.intervened` | `true` when the guardrail stopped generation                  |
| `aws.bedrock.guardrail.id`         | from the trace; needs `guardrailConfig.trace: 'enabled'`      |

`gen_ai.response.finish_reasons` keeps the unified value. An intervention is a policy outcome: the span's status stays unset, and `guardrail.intervened / total` is one query.

### Bedrock-only pricing

`BEDROCK_PRICING` covers Nova, Llama, Mistral, DeepSeek and GLM. Bedrock bills Anthropic models at Anthropic's rates and `autotel-genai` prices those by family. Keys resolve the way `autotel-genai/cost` does (exact, then prefix, after each region and vendor prefix is peeled), so `eu.amazon.nova-pro-v1:0` resolves via `amazon.nova-pro`. Spread and override what you use:

```typescript
autotelTelemetry({
  pricing: {
    ...BEDROCK_PRICING,
    'zai.glm-4.7-flash': { inputPer1M: 0.5, outputPer1M: 2 },
  },
});
```

Runnable example: `apps/example-bedrock` in the autotel repository.

## Review checklist

- `bedrockCompatibility()` sits in `spanEnrichers`, never `spanProcessors`.
- `providerAttributes: bedrockProviderAttributes` is passed to `autotelTelemetry`, or Bedrock's stop reason stays folded into the AI SDK's.
- Guardrail ids need `guardrailConfig.trace: 'enabled'` on the request; without the trace only `stop_reason` and `intervened` are recorded.
- Prices are a default; override with the rates on the account's pricing page.
