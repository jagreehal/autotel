# Contributor Skills

Skills in this directory are for **contributors working inside the autotel monorepo** — authoring new packages that follow autotel conventions. They are not shipped to consumers via npm.

| Skill | Purpose |
| --- | --- |
| [`create-autotel-adapter`](create-autotel-adapter/SKILL.md) | Author a new framework adapter (Elysia, Fastify, …). |
| [`create-autotel-instrumentation`](create-autotel-instrumentation/SKILL.md) | Auto-instrument a third-party library (Drizzle, Mongoose, Redis, …). |
| [`create-autotel-exporter`](create-autotel-exporter/SKILL.md) | Ship a new vendor exporter with retry, batch, error handling. |

User-facing skills live with the package they describe — under `packages/<pkg>/skills/`. Spec-compliant agents (Claude Code, Cursor, Windsurf, Continue, …) discover them automatically by scanning `node_modules/<pkg>/skills/SKILL.md` after the package is installed.

## Skill format

Skills follow the [Agent Skills specification](https://agentskills.io/specification). Minimal frontmatter:

```yaml
---
name: kebab-case-name
description: >
  One-paragraph summary of what the skill does and when to use it.
license: MIT
---
```

References (`scripts/`, `references/`, `assets/`) are loaded lazily — agents only fetch them when actively needed.
