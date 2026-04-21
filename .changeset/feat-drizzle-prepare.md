---
'autotel-drizzle': patch
---

Fix duplicate `drizzle.*` spans. `instrumentDrizzleClient` no longer instruments `db.$client` — drizzle's session internally dispatches to that same client from within its already-traced prepared query `execute`, which caused every query to emit nested duplicate spans with identical `db.statement`. Session-level instrumentation is now the single source of truth. Consumers who need to trace a standalone client without a drizzle wrapper can still call `instrumentDrizzle(client)` directly.
