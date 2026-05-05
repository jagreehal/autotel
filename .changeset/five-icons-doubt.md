---
'autotel-mcp-instrumentation': patch
'autotel-subscribers': patch
'autotel-cloudflare': patch
'autotel-playwright': patch
'autotel-adapters': patch
'autotel-backends': patch
'autotel-devtools': patch
'autotel-mongoose': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-drizzle': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-vitest': patch
'autotel-edge': patch
'autotel-hono': patch
'autotel-aws': patch
'autotel-cli': patch
'autotel-mcp': patch
'autotel-web': patch
'autotel': patch
---

Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).

- Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
- Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
- Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
- Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
- Realign `autotel`'s peer dependency ranges to match published versions on npm.
- Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.
