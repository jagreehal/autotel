---
'autotel-drizzle': patch
'autotel-mcp': patch
---

- `autotel-drizzle`: add `db.statement.hash` span attribute so SQL queries can be grouped even when statement text capture is disabled.
- `autotel-mcp`: improve Jaeger parent span mapping via `references[].refType === "CHILD_OF"`, clamp root-cause percent-of-trace to a sane range, and include backend signal capabilities in `backend_health`.
