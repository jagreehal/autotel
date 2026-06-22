---
'autotel': patch
'autotel-genai': patch
'autotel-devtools': patch
---

Refresh the AI SDK guidance across published skills and docs.

- document `autotelTelemetry()` as the primary Vercel AI SDK integration
- document `subscribeAiTelemetry()` as the zero-config fallback
- move `observeAiSdkResult()` and `autotel-genai/ai-sdk` guidance into the legacy/enrichment path
- update review skills to stop recommending `experimental_telemetry`
