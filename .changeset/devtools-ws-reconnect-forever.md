---
'autotel-devtools': patch
---

fix(autotel-devtools): widget WebSocket client reconnects indefinitely instead of giving up

The widget's WebSocket client stopped retrying after 10 reconnect attempts with
uncapped exponential backoff, so a laptop sleep or devtools server restart
permanently killed live updates until a full page reload. It now retries
forever with backoff capped at 15s — the server replays full history on
reconnect, so the widget self-heals. An intentional `disconnect()` no longer
schedules a reconnect (the old socket's `close` event previously resurrected
the connection it had just torn down).

The widget's connection indicator now tracks the socket's real state via a
status callback instead of the one-shot `connect()` promise, so it shows
"disconnected" during an outage rather than staying frozen on "connected".
