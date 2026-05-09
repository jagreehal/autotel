# autotel-vscode

VSCode extension. Reuses parsing/aggregation primitives from `autotel-devtools/server` (parseOtlpTraces, parseOtlpLogs, ErrorAggregator, appendWithLimit). Does NOT instantiate `DevtoolsServer` — owns its own `http.createServer()`.

## Build outputs

- `tsup` → `dist/extension.js` (CJS, bundles autotel-devtools)
- `vite` → `dist/webview/span-detail.js` (IIFE)

## Boundaries

- Webview is read-only (postMessage only emits intents, never mutates state)
- Receiver binds 127.0.0.1 by default
- All credentials go through `vscode.SecretStorage` (v0.2+), never settings
