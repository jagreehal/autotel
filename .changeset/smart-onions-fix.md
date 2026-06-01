---
'autotel-devtools': patch
'autotel': patch
---

### autotel-devtools — CLI port shorthand, busy-port fallback, theme fix

- **Port as a positional:** `npx autotel-devtools 4319` is shorthand for `--port 4319`; an explicit `--port`/`-p` always wins. Invalid ports exit with code 2.
- **Busy-port fallback:** if the requested port is in use, the receiver walks forward (up to 20 consecutive ports) and binds the first free one, printing a warning with the actual port. Startup URLs and OTLP hints use the bound port.
- **Bind-phase crash fix:** swallow WebSocketServer `error` re-emissions from `ws` during `EADDRINUSE` recovery so port-fallback probing no longer crashes the process.
- **Theme in shadow DOM:** apply `data-theme` on the shadow host (via `getRootNode().host`) instead of `document.querySelector('autotel-devtools')`, so light/dark tokens resolve inside the widget stylesheet.

### autotel — lazy `node-require` for edge runtimes

Defer `createRequire()` until the first `safeRequire()` / `requireModule()` / `nodeRequire()` call so merely importing `node-require` (and re-exports such as `track`) no longer throws in runtimes without a module path (e.g. Cloudflare Workers / workerd). Optional lookups still degrade to `undefined` via `safeRequire()`; `nodeRequire.resolve` (and `resolve.paths`) are forwarded lazily.
