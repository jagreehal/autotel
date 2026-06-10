---
'autotel': minor
---

New `autotel/security-schema` export — the dependency-free single source of truth for the security telemetry wire schema: `SecuritySeverity` + rank/parse/compare/escalate helpers, `SECURITY_ATTR` span-attribute keys, `SECURITY_METRICS` metric names, default denied statuses, and the HTTP status attribute fallback order. `autotel-audit`, `autotel-subscribers`, and `autotel-devtools` now consume the schema from here instead of re-declaring it.
