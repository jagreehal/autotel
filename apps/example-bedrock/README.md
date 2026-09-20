# example-bedrock

A Lambda-hosted **AI SDK tool-loop agent on Amazon Bedrock**, traced end to end:

- [`autotel-aws/lambda`](../../packages/autotel-aws): `wrapHandler` opens the root span, records the cold start and trigger, and flushes telemetry before Lambda freezes the sandbox.
- [`autotel-genai`](../../packages/autotel-genai): `autotelTelemetry()` turns every AI SDK call into an `invoke_agent › chat › execute_tool` span tree with token usage and cost.
- [`autotel-bedrock`](../../packages/autotel-bedrock): `bedrockCompatibility()` puts the foundation-model id behind an inference profile or ARN on the span, `bedrockProviderAttributes` adds Bedrock's own stop reason and guardrail outcome, and `BEDROCK_PRICING` prices the models that exist only behind Bedrock.

```ts
init({
  service: 'example-bedrock',
  spanEnrichers: [bedrockCompatibility()],
});

registerTelemetry(
  autotelTelemetry({
    pricing: BEDROCK_PRICING,
    providerAttributes: bedrockProviderAttributes,
  }),
);

export const handler = wrapHandler(async (event) => {
  const result = await agent.generate({ prompt: event.prompt });
  return { statusCode: 200, body: result.text };
});
```

## Run

The handler runs in-process against Bedrock with the default AWS credential chain (a profile, SSO session or `AWS_BEARER_TOKEN_BEDROCK`), prints the trace, and checks every model call carries the Bedrock attributes:

```bash
AWS_PROFILE=<profile> AWS_REGION=eu-west-1 pnpm --filter @jagreehal/example-bedrock start
AWS_PROFILE=<profile> BEDROCK_MODEL_ID=zai.glm-4.7-flash pnpm --filter @jagreehal/example-bedrock start "Any orders for Northwind?"
```

`BEDROCK_MODEL_ID` takes a foundation-model id, an inference profile (the default, `eu.anthropic.claude-haiku-4-5-20251001-v1:0`) or an ARN. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to also send the trace to a collector.

## What it shows

```
lambda.example-bedrock [internal]
  └ invoke_agent orders-agent [internal]
    └ chat zai.glm-4.7-flash [client]  —  tokens 343→53 · $0.000322 · stop tool_use
    └ execute_tool findCustomer [internal]  —  args {"name":"Acme"}
    └ chat zai.glm-4.7-flash [client]  —  tokens 424→14 · $0.000285 · stop tool_use
    └ execute_tool getRecentOrders [internal]  —  args {"customerId":"c-100","limit":5}
    └ chat zai.glm-4.7-flash [client]  —  tokens 509→81 · $0.000484 · stop end_turn
```

| Attribute                                                      | From                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `gen_ai.request.model`                                         | `bedrockCompatibility()`, normalised to the foundation id                     |
| `aws.bedrock.model.vendor`, `cloud.region`                     | `bedrockCompatibility()`                                                      |
| `aws.bedrock.stop_reason`                                      | `bedrockProviderAttributes`                                                   |
| `aws.bedrock.guardrail.intervened`, `aws.bedrock.guardrail.id` | `bedrockProviderAttributes` (the id needs `guardrailConfig.trace: 'enabled'`) |
| `gen_ai.usage.cost.usd`                                        | `BEDROCK_PRICING`                                                             |

## Related

- Ollama version of the AI SDK observer: [`example-ai-sdk-observer`](../example-ai-sdk-observer).
- Lambda deployment with CDK: [`example-aws-lambda`](../example-aws-lambda).
