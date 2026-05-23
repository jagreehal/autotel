---
'autotel-eventcatalog': patch
---

Tighten the policy layer based on a code-review pass.

- `PolicyEvaluationResult` drops the redundant `mode` field. `reason` is
  retained and now used: the CLI prints it on stderr at the end of every
  drift run so CI logs say *"Drift detected in current snapshot."* or
  *"No new drift introduced compared to baseline snapshot."* — explaining
  the exit code rather than just emitting it.

- The CLI no longer silently rewrites `--policy all` to `--policy
  new-only` when `--base-snapshot` is present. The effective policy is
  derived at the use site: explicit flag wins, otherwise default to
  `new-only` when a baseline is supplied, else `all`. Same behaviour for
  users who omit `--policy`; no more "we secretly mutated your flag"
  surprise for users who set it explicitly.

- The JSON output (`--format json`) is now versioned with a
  `spec: 'autotel-eventcatalog-report/v0.1.0'` marker on every envelope,
  so downstream tooling can detect and refuse unknown major versions.
  Exported as `REPORT_SPEC` from the library.

- New e2e test suite (`cli.e2e.test.ts`) spawns the built CLI against
  fixture catalogs and asserts exit codes + outputs for: clean state
  with `--fail-on-drift`, drift with `--fail-on-drift`, drift without
  `--fail-on-drift` (the original P0 regression class), `--policy
  new-only` without `--base-snapshot`, versioned JSON output, unknown
  flags, and `stamp --dry-run`. Run via `pnpm test:e2e`.
