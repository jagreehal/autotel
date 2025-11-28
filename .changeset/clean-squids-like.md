---
'autotel': minor
---

Lazy-load logger + auto instrumentation packages so we only require
optional peers when a matching logger/integration is configured. Expose
test hooks for the loader so we can simulate different setups without
installing every instrumentation locally.
