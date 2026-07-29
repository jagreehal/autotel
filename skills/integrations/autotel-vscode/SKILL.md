---
name: autotel-vscode
description: >
  Use this skill when working with the Autotel VS Code extension — a local OTLP/HTTP receiver on 127.0.0.1:4318 that buffers traces and logs, shows Services/Traces/Logs/Errors views, embeds the autotel-devtools widget in a webview, and reveals source from code.filepath/code.lineno. Covers receiver start/stop, the auto-start rule, and port conflicts.
---

# autotel-vscode

Observability inside the editor. The extension runs a local OTLP/HTTP receiver, buffers what your app sends, and shows it in the sidebar. Click a span, jump to the line that produced it. No Docker, no collector, no SaaS account.

The receiver listens on `POST /v1/traces` and `POST /v1/logs` at `127.0.0.1:4318` — the default OTLP/HTTP endpoint, so most SDKs need no extra config.

## When to use

- View traces, logs, and grouped errors from a local app without leaving VS Code.
- Jump from a span to its source line.
- Diagnose why the receiver isn't capturing (auto-start rule, port conflict).

## How it works

Point your app at `http://127.0.0.1:4318`. Open the Autotel activity bar. Four live views read the in-memory buffer: Services, Traces, Logs, Errors (grouped by fingerprint). Opening a span embeds the full `autotel-devtools` widget in a webview, deep-linked to that span. **Reveal Source** opens `code.filepath`:`code.lineno`; files outside the workspace are refused.

The status bar reflects receiver state: `Autotel :4318 (12)` running with buffered count, `Autotel off :4318` stopped, or a busy warning when the port won't bind. Click it to start or stop.

## Auto-start rule

The receiver does **not** bind the moment VS Code opens. It auto-starts only in workspaces that depend on `autotel`; elsewhere it stays dormant until you run **Autotel: Start Receiver**. This keeps it from fighting a local collector or a second window over port 4318.

- `autotel.receiver.autoStart: "off"` — always start by hand.
- `autotel.receiver.autoStart: "always"` — start in every workspace.

Auto-start is quiet (status bar + output channel, no pop-ups). Starting by hand is loud: you get a notification if it can't bind.

## Common mistakes

### HIGH: Expecting capture when the status bar says `Autotel off`

In a workspace that doesn't depend on `autotel`, the receiver stays dormant. Click the status bar item or run **Autotel: Start Receiver**.

### MEDIUM: Port 4318 already taken by a local collector

Run **Autotel: Set Receiver Port** and pick another; point your app at the new port. The status bar shows "port busy" until the conflict clears.

## Related

- `autotel-devtools` — the widget embedded in the webview; `npx autotel-devtools` runs it standalone outside VS Code.

## Version

Distributed as a VS Code extension, not an npm library. Receiver is OTLP/HTTP only.
