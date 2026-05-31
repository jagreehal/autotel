# autotel-vscode

VSCode extension. The receiver is a `DevtoolsServer` + `attachDevtoolsRoutes` (from `autotel-devtools/server`) on its own `http.createServer()`, so the same port both ingests OTLP and serves the embeddable devtools widget (`/`, `/widget.js`, `/ws`). `openDevtools` points its webview iframe at that local URL, rendering the full widget fed live. The extension keeps a read model (traces/logs/spans/errors) in sync via the `DevtoolsServer` `onData` hook for its tree views, CodeLens and hover. Still reuses `ErrorAggregator` for the Errors tree.

## Build outputs

- `tsup` → `dist/extension.js` (CJS, bundles autotel-devtools)
- `vite` → `dist/webview/span-detail.js` (IIFE)

## Boundaries

- Webview is read-only (postMessage only emits intents, never mutates state)
- Receiver binds 127.0.0.1 by default
- All credentials go through `vscode.SecretStorage` (v0.2+), never settings
