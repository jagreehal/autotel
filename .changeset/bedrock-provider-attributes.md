---
'autotel-bedrock': minor
'autotel-genai': minor
'autotel-aws': minor
'autotel': minor
---

New package `autotel-bedrock`: `bedrockCompatibility()` normalises inference-profile ids and ARNs to the foundation model and adds `cloud.*` attributes; `bedrockProviderAttributes` records Bedrock's own stop reason, whether a guardrail intervened and which one; `BEDROCK_PRICING` prices the models that exist only behind Bedrock.

`autotel-genai`: `autotelTelemetry({ providerAttributes })` hands the provider's raw finish reason and `providerMetadata` (from the model call's result or its stream's `finish` part) to a hook that adds attributes to the `chat` span. `subscribeAiTelemetry` reads the unified finish reason from AI SDK 7 model responses. `wrapEvaluationModel` and `evaluationScore` for evaluation calls.

`autotel-aws`: `wrapHandler` and `traceLambda` flush telemetry before the handler returns, so spans export before Lambda freezes the sandbox (`{ flush: false }` opts out); a flush that fails leaves the handler's own result or error in place.

`autotel`: `init()` registers providers through its own `AutotelSdk`, so bundles that contain `init()` no longer carry the gRPC, Prometheus and file-config exporters `@opentelemetry/sdk-node` imports. `sdkFactory` still accepts a `NodeSDK` built from the same options. `shutdown()` flushes every provider before shutting it down.
