---
'autotel-devtools': patch
---

Guard the receiver's read surface against cross-origin scraping by web pages.

The captured-telemetry read-back (`GET /v1/traces`), the clear endpoint (`DELETE /v1/traces`) and the live WebSocket (`/ws`) are now origin-checked. Previously every response carried `Access-Control-Allow-Origin: *`, so any website a developer happened to visit could `fetch('http://127.0.0.1:4318/v1/traces')` or open `ws://127.0.0.1:4318/ws` and read their locally captured prompts, responses and tokens.

Two checks, matching the threat model:

- A request to a read/stream endpoint carrying a **non-loopback `Origin`** (a cross-origin browser read) is rejected with `403`.
- When the receiver is bound to a loopback host (the default), a **non-loopback `Host`** (DNS rebinding, where the read looks same-origin and may carry no `Origin`) is also rejected. An explicit non-loopback bind (`--host 0.0.0.0`) is treated as an opt-in to network exposure, so only the `Origin` check applies there.

OTLP ingestion (`POST /v1/{traces,logs,metrics}`), `widget.js` and `healthz` stay fully open — browser apps on arbitrary dev origins must still send telemetry and load the embeddable widget, which keeps working because it connects from a loopback origin. Server-side reads with no `Origin` (curl, Node `fetch` in Playwright tests) are unaffected.

New guard helpers are exported from `autotel-devtools/server`: `allowSensitiveRequest`, `isLoopbackHostname`, `hostHeaderIsLoopback`, `originIsLoopback`.
