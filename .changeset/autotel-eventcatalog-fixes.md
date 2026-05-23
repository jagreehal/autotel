---
'autotel-eventcatalog': patch
---

Two correctness fixes flagged in code review:

**P0**: The CLI only exits non-zero on drift when `--fail-on-drift` is set.
The bundled GitHub Action's internal script captured `STATUS=$?` from the
CLI without passing `--fail-on-drift`, so the action's `drift-detected`
output and the downstream "Fail on drift" step never fired even when
drift was present. Fixed by always passing `--fail-on-drift` from the
action's internal script — the user-facing `fail-on-drift` input now
governs whether the workflow step fails, but the action's drift signal
is no longer gated on it.

**P1**: `readCatalogState` matched literal `'/'` separators for
directory classification. On Windows runners the path separator is `\`,
so the `'/versioned/'` exclusion and the `services/events/channels`
classification both silently misbehaved. Paths are now normalised to a
canonical POSIX form before string-matching, so classification works
identically on every platform.

The CLI exit-code contract is now documented as:

  0 — no drift
  1 — drift detected (only when `--fail-on-drift` is set)
  2 — bad arguments
  other — hard failure (surface to the user)
