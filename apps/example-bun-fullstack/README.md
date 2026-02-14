# example-bun-fullstack

Minimal **Bun + autotel** example: one process, autotel init and a traced endpoint. Confirms autotel works with Bun.

- **Server**: `Bun.serve` with `GET /` and `GET /api/health`. Both return a traced value via `trace()`.
- **Dependency**: `autotel` only (workspace). No autotel-web.

## Run

From repo root:

```bash
pnpm --filter @jagreehal/example-bun-fullstack start
```

Or from this directory (after `pnpm install` from root):

```bash
bun run src/index.ts
```

Then open http://localhost:3000 or http://localhost:3000/api/health — you should see `{"status":"ok","timestamp":"..."}`. With an OTLP collector or debug, you’ll see a span for the traced `getHealth()` call.

## Why Bun + autotel

- **Bun**: Single runtime, fast, native `fetch`-based server.
- **autotel**: One `init()`, one `trace()`-wrapped function returning a value — simplest way to confirm autotel works with Bun.
