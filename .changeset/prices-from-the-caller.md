---
'autotel-genai': minor
'autotel-bedrock': major
---

You supply every price, dated.

- autotel-genai: register prices with `registerModelPricing({...})`, or pass `pricing` to `autotelTelemetry`, `createGenAiObserver` or a single call. `registeredModelPricing()` lists what is in effect. A model you have not priced records `gen_ai.usage.cost.unpriced_model`.
- Add `asOf` and `source` to a price. Every span that carries a cost records the date as `gen_ai.usage.cost.price_as_of`, and `priceAsOf(model)` returns it.
- A model's `serverToolPer1K` prices its server-side tools.
- autotel-genai drops `MODEL_PRICING` and `SERVER_TOOL_PRICING_PER_1K`; autotel-bedrock drops `BEDROCK_PRICING` and `BedrockModelPricing`. Register the prices you use at startup to keep your costs.
