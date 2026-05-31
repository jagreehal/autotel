---
'autotel': minor
---

Add opt-in function I/O capture to `trace()` / `instrument()` via `captureInput` / `captureOutput`.

When enabled per call, the function arguments and return value are serialized (JSON, truncated at 4096 chars) onto the span as `autotel.input` / `autotel.output`. A single argument is captured directly; multiple arguments are captured as an array. Both default to `false`, so nothing changes unless you opt in. This is the standard convention visualizers (incl. the autotel-devtools Flow view) read to show plain functions with the same input/output detail as AI tool calls.

```ts
const loadPortfolio = trace(
  { name: 'loadPortfolio', captureInput: true, captureOutput: true },
  (ctx) => async (req: { userId: string }) => fetchPortfolio(req.userId),
);
```

Avoid on arguments containing secrets/PII, or pair with a redacting span processor.
