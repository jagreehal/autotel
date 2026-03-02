---
'autotel-cloudflare': minor
'autotel-edge': minor
---

**autotel-cloudflare**

- Bindings instrumentation: add caching and fix `this` binding for wrapped proxies
- Improve bindings coverage for AI, Vectorize, Hyperdrive, Queue Producer, Analytics Engine, Images, Rate Limiter, and Browser Rendering
- Enhance instrument wrapper and fetch instrumentation
- Add bindings cache and this-binding tests

**autotel-edge**

- Add `DataSafetyConfig` for sensitive attribute control: `redactQueryParams`, `captureDbStatement` (D1 SQL: full/obfuscated/off), `emailHeaderAllowlist`
