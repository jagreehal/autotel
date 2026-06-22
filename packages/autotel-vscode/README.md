# Autotel for VS Code

Observability without leaving your editor. The extension runs a local OTLP/HTTP receiver, buffers what your app sends, and shows it in the sidebar. Click a span and jump to the line of code that produced it.

## What you get

The receiver listens on `POST /v1/traces` and `POST /v1/logs` at `127.0.0.1:4318`. Nothing else is needed: no Docker, no collector, no SaaS account.

The activity bar has four views populated live from the in-memory buffer: Services, Traces, Logs, and Errors. Errors are grouped by fingerprint so the same exception across many traces collapses into a single row with a count.

Opening a span (or **Open Devtools UI**) embeds the full `autotel-devtools` widget — Traces waterfall, Flow call graph, GenAI, Logs, Errors — in a VS Code webview, served from the same receiver and fed live. Clicking a span deep-links the widget straight to it. If a span carries `code.filepath` and `code.lineno`, **Reveal Source** opens the file at the right line; files outside the workspace are refused.

The status bar shows the receiver state and the configured port at a glance: `Autotel :4318 (12)` when running (port and buffered span count), `Autotel off :4318` when stopped, or a "busy" warning when the port could not bind. Click it to start when stopped, or stop when running.

By default the receiver does **not** bind a port the moment VS Code opens. It auto-starts only in workspaces that depend on `autotel`; everywhere else it stays dormant until you run **Autotel: Start Receiver** (or click the status bar item). This keeps it from fighting a local collector or a second VS Code window over port 4318. Set `autotel.receiver.autoStart` to `"off"` to always start it by hand, or `"always"` to start it in every workspace.

Auto-start is quiet: if the port is already taken (or the host is non-loopback and needs consent), it just reflects that in the status bar and logs to the **Autotel** output channel — no pop-ups. Starting by hand is loud: because you asked, you get a notification if it can't bind.

## Getting started

Install the extension. Point your app at `http://127.0.0.1:4318`. That is the default OTLP/HTTP endpoint, so most SDKs need no extra configuration.

Open the Autotel activity bar. If the receiver is stopped (`Autotel off` in the status bar), click the status bar item or run **Autotel: Start Receiver**. Click a span to open the embedded Devtools widget focused on it. **Reveal Source** opens the code.

If port 4318 is taken (most often by a local OpenTelemetry Collector), run **Autotel: Set Receiver Port** and pick another one. The status bar will say "port busy" until the conflict is resolved.

## Commands

| Command | What it does |
| --- | --- |
| `Autotel: Start Receiver` | Start the OTLP HTTP receiver. |
| `Autotel: Stop Receiver` | Stop the receiver and free the port. |
| `Autotel: Set Receiver Port` | Change the listen port (saved in workspace settings). |
| `Autotel: Clear Buffered Data` | Drop all buffered spans, logs, and error groups. |
| `Autotel: Reveal Span Source` | Jump to `code.filepath`:`code.lineno` for the selected span. |
| `Autotel: Copy Span ID` | Copy the span ID to the clipboard. |
| `Autotel: Open Span Detail` | Open the embedded Devtools widget focused on the selected span. |
| `Autotel: Open Devtools UI` | Open the embedded `autotel-devtools` widget in a VS Code webview (or browser). |

If you want a standalone Devtools UI process outside VS Code, run `npx autotel-devtools`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `autotel.receiver.autoStart` | `onAutotelProject` | When to start the receiver. `off` = manual only; `onAutotelProject` = auto-start only in workspaces that depend on autotel; `always` = auto-start in every workspace. |
| `autotel.receiver.host` | `127.0.0.1` | Bind host. `0.0.0.0` works but exposes telemetry beyond loopback, so the extension prompts before allowing it. |
| `autotel.receiver.port` | `4318` | TCP port. |
| `autotel.buffer.maxSpans` | `10000` | Span buffer cap. Older spans are dropped past the cap and the count shows in the status bar tooltip. |
| `autotel.buffer.maxLogs` | `10000` | Log buffer cap. |
| `autotel.buffer.maxAgeMs` | `1800000` | Reserved for future age-based eviction. |
| `autotel.devtools.url` | `null` | Optional URL for an existing `autotel-devtools` UI. If unset, falls back to `http://<receiver.host>:<receiver.port>`. |

## Security

The receiver only binds to `127.0.0.1` by default. If you change the host to something non-loopback, the extension asks before starting. The "reveal source" command refuses to open paths outside any workspace folder, and path traversal is rejected at the boundary check rather than relying on string prefix matching.

No credentials live in settings. When remote-export support lands in v0.2, secrets will go through `vscode.SecretStorage`.

## Limits

- Maximum request body is 10 MB. Anything larger is rejected with `413 Payload too large`.
- OTLP/HTTP with JSON payloads only. Protobuf is not yet wired up.
- Requires VS Code `1.85` or later.

## License

MIT. See `LICENSE`.
