---
'autotel-cloudflare': minor
---

Add full Cloudflare native observability parity.

- **New binding instrumentations**: AI, Vectorize, Hyperdrive, Queue Producer, Analytics Engine, Images, Rate Limiter, and Browser Rendering
- **`setAttr()` helper**: Guards against undefined/null attribute values when setting span attributes
- **Auto-detection rewrite**: Uses `hasExactMethods()` and `isWrapped()` guards with most-specific-first ordering (fixes R2/KV detection bug)
- **`extractCfAttributes()`**: Extracts 14 `cloudflare.*` request attributes (colo, ray_id, geo, ASN, TLS, etc.)
- **Exports**: Explicit named exports for tree-shaking
- **Tests**: 88 new tests (173 total)
