---
'autotel-vscode': minor
---

Embed the real devtools widget inside the extension. The receiver is now a `DevtoolsServer` + `attachDevtoolsRoutes` (replacing the bespoke `http.createServer` handler), so the same port that ingests OTLP also serves the widget UI (`/`, `/widget.js`, `/ws`). The `Open Devtools` command now points its webview at this local URL by default — the full Traces / Flow / GenAI / Logs / Errors widget renders live, with no separate `npx autotel-devtools` process. The extension's tree views, CodeLens and hover stay in sync via the new `DevtoolsServer` `onData` hook, and backend-query results flow through the same path so they appear in the widget too. Payload-size limiting and OTLP route handling are now owned by the shared server.
