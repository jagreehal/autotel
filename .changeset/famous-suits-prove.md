---
'autotel': minor
---

Add ESM misconfiguration detection and improve documentation

- Add `isESMMode()` detection to provide context-aware error messages when `@opentelemetry/auto-instrumentations-node` fails to load
- ESM users now get detailed setup instructions including the correct `autotel/register` pattern
- Add informational warning when using `integrations` in ESM mode, guiding users to the recommended `getNodeAutoInstrumentations()` pattern
- Update README.md with modern ESM setup instructions using `autotel/register` (Node 18.19+)
- Document requirement to install `@opentelemetry/auto-instrumentations-node` as a direct dependency for ESM apps
