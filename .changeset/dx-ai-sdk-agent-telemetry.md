---
'autotel-genai': patch
---

Fix `autotelTelemetry()` assignability under `exactOptionalPropertyTypes: true`, and document the two AI SDK agent gotchas it exposed.

The `*View` event interfaces declared `?: T` where the SDK passes `?: T | undefined`, so `registerTelemetry(autotelTelemetry())` failed to type-check for consumers with that flag on — despite the README promising it type-checks as-is. Every optional field on the view types is now `?: T | undefined`.

Also documented, because both cost real debugging time:

- `ToolLoopAgent` takes `telemetry` on the **constructor**, not on `.generate()`. Passing it to `.generate()` is a type error; spreading it in type-checks and is silently dropped.
- `runtimeContext` never reaches telemetry unless the call names each key in `telemetry.includeRuntimeContext`, so `gen_ai.conversation.id` is absent without it. The existing unit test constructed the event with `runtimeContext` already populated, so it could not catch this.

`example-ai-sdk-observer` gains a `ToolLoopAgent` demo asserting both contracts against a real model, and now type-checks under `exactOptionalPropertyTypes: true` so the assignability fix stays pinned.
