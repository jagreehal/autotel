---
'autotel-cli': patch
---

Improve `autotel init` DX with a stricter, agent-native flow and safer merge behavior.

- Add detection/plan-driven init modes: `--detect-only`, `--plan`, `--input`, `--scan-env`, plus JSON output controls (`--json`, `--output-file`, `--no-secrets-in-output`, `--no-interactive`).
- Add agent discovery commands: `schema`, `schema errors`, `schema outputs`, `commands`, `examples`, and JSON `version`.
- Introduce structured CLI errors (`AUTOTEL_E_*`) with stable envelopes and consistent exit-code mapping.
- Remove legacy prompt fallback from `init`: when detection is disabled, a plan source (`--plan`, `--input`, or `--preset`) is now required.
- Fix CLI-owned instrumentation merge logic to rewrite when rendered content changes (even if import sources are unchanged), preventing stale backend config/specifier drift.
- Add coverage for merge regression and non-interactive/no-plan-source fail-fast behavior.
