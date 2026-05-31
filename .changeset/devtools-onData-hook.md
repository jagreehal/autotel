---
'autotel-devtools': minor
---

`DevtoolsServer` gains an optional `onData(incremental)` callback, invoked after each ingest with the data just broadcast to WebSocket clients. Lets an embedder (e.g. the VS Code extension) keep its own views in sync while the server owns the buffer, error aggregation and WS fan-out. Listener errors are swallowed so a bad embedder can't break ingestion.
