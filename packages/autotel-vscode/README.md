# Autotel for VS Code

Observability without leaving your editor. The extension runs a local OTLP/HTTP receiver, buffers what your app sends, and shows it in the sidebar. Click a span and jump to the line of code that produced it.

## What you get

The receiver listens on `POST /v1/traces` and `POST /v1/logs` at `127.0.0.1:4318`. Nothing else is needed: no Docker, no collector, no SaaS account.

The activity bar has four views populated live from the in-memory buffer: Services, Traces, Logs, and Errors. Errors are grouped by fingerprint so the same exception across many traces collapses into a single row with a count.

Spans open in a webview that shows status, timing, attributes, and any events. If a span carries `code.filepath` and `code.lineno`, there is a "Reveal Source" button that opens the file at the right line. Files outside the workspace are refused.

The status bar tells you whether the receiver is running, stopped, or could not bind. Click it to start.

## Getting started

Install the extension. Point your app at `http://127.0.0.1:4318`. That is the default OTLP/HTTP endpoint, so most SDKs need no extra configuration.

Open the Autotel activity bar. Right-click a span and choose **Open Span Detail**. From there, **Reveal Source** opens the code.

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
| `Autotel: Open Span Detail` | Open the span in a detail webview. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `autotel.receiver.enabled` | `true` | Boot the receiver on activation. |
| `autotel.receiver.host` | `127.0.0.1` | Bind host. `0.0.0.0` works but exposes telemetry beyond loopback, so the extension prompts before allowing it. |
| `autotel.receiver.port` | `4318` | TCP port. |
| `autotel.buffer.maxSpans` | `10000` | Span buffer cap. Older spans are dropped past the cap and the count shows in the status bar tooltip. |
| `autotel.buffer.maxLogs` | `10000` | Log buffer cap. |
| `autotel.buffer.maxAgeMs` | `1800000` | Reserved for future age-based eviction. |
| `autotel.source.workspaceRoot` | `null` | Override workspace root for source resolution. `null` means auto-detect. |
| `autotel.source.followSymlinks` | `false` | Follow symlinks when resolving span source paths. |

## Security

The receiver only binds to `127.0.0.1` by default. If you change the host to something non-loopback, the extension asks before starting. The "reveal source" command refuses to open paths outside any workspace folder, and path traversal is rejected at the boundary check rather than relying on string prefix matching.

No credentials live in settings. When remote-export support lands in v0.2, secrets will go through `vscode.SecretStorage`.

## Limits

- Maximum request body is 10 MB. Anything larger is rejected with `413 Payload too large`.
- OTLP/HTTP with JSON payloads only. Protobuf is not yet wired up.
- Requires VS Code `1.85` or later.

## License

MIT. See `LICENSE`.
