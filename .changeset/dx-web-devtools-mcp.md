---
'autotel-web': minor
'autotel-devtools': patch
'autotel-mcp': patch
---

`autotel-web`: `initFull` skips the per-resource `resourceFetch` spans in development (`NODE_ENV !== 'production'` where a bundler substituted one, otherwise a page served from localhost), since a dev server turns one page load into hundreds of spans about the bundler. `documentLoad` and `documentFetch` stay, and `captureResourceTiming: true | false` overrides the default. The library build leaves `process.env.NODE_ENV` for the consuming bundler to substitute, and the filter keeps the provider's parent-based sampling for other spans.

`autotel-devtools`: error groups read the message from the span's `exception` event, and an exception with an empty message is grouped under its type.

`autotel-mcp`: `backend_health` for the devtools backend names the URL it reached, so a stale devtools on another port is visible from the message.
