# Autotel — Guide for AI Coding Agents

This file is the **single source of truth** for AI coding assistants (Cursor, Claude Code, etc.) working in the Autotel repo or in codebases that use Autotel. Use it to suggest correct instrumentation, avoid anti-patterns, and keep changes consistent with project rules.

## Keeping This File Updated

Update this file proactively when:

- **Recurring mistake**: The same error appears twice (wrong import path, wrong API, incorrect assumption) → add a note under the relevant section or a callout.
- **Maintainer guidance**: You're told to always/never do something or to follow a structural rule → capture it here so future sessions follow it.
- **New pattern**: A new convention is agreed on (naming, architecture, where to put new code) → document it under the right section.
- **Full refresh**: After a broad update (e.g. "align all examples with X"), add a short note on what was done and what invariant to maintain.

When updating, be specific and actionable. Prefer short, targeted notes.

---

## What Autotel Is (vs evlog-style logging)

**evlog** (for comparison): One log per request ("wide events"), structured errors, request-scoped logger, drain/enrich pipeline. Agent skills teach: review logging, replace `console.log` with wide events, use `createError`/`parseError`.

**Autotel**: OpenTelemetry-first. Traces, spans, and metrics flow to any OTLP backend. Agent guidance should focus on:

- **Traces and spans**: `trace()`, `span()`, `instrument()` for business logic and frameworks.
- **Request-scoped context**: `getRequestLogger()` for one snapshot per request (attributes + events on the active span).
- **Structured errors**: `createStructuredError()` and `parseError()` for errors that explain why and how to fix.
- **Product events**: `track()` and Event API for product/analytics events via subscribers.
- **No vendor lock-in**: Instrument once; backends (Grafana, Datadog, Honeycomb, etc.) consume OTLP.

When suggesting code in a **user's app** (not this repo), recommend Autotel APIs above. When working **inside this repo**, follow the boundaries and touchpoints in this file and in `docs/AGENT-GUIDE.md`.

---

## Philosophy

- **Write once, observe everywhere**: One instrumentation surface; many backends via OTLP.
- **Functional API**: Wrap handlers and functions with `trace()`, `span()`, `instrument()`; avoid manual span lifecycle where possible.
- **Structured errors**: Errors should carry `message`, `why`, `fix`, `link` (and optionally `status`, `code`, `cause`) so agents and users can diagnose and act.
- **Request context**: Use `getRequestLogger()` when you need one coherent snapshot per request (attributes + log events on the span).

### Cloudflare Direction

- For `autotel-cloudflare`, prefer one DX across Workers, Queues, Scheduled, Email, Durable Objects, alarms, and Workflows.
- Keep `trace(..., (ctx) => ...)` as the main user-facing instrumentation pattern for Cloudflare business logic.
- Prefer span attributes plus one execution-scoped snapshot over scattered `logger.info(...)` calls in Cloudflare examples.
- If Cloudflare needs request-logger-style DX, implement it in `autotel-edge` first using edge-safe context primitives. Do not copy the Node `AsyncLocalStorage` implementation from core `autotel`.

---

## Quick Reference

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `pnpm build`           | Build all packages                       |
| `pnpm test`            | Run all tests                            |
| `pnpm lint`            | Lint all packages                        |
| `pnpm format`          | Format with Prettier                     |
| `pnpm quality`         | Build + lint + format + typecheck + test |
| `pnpm intent:validate` | Validate Agent Skills in all packages    |

**Agent Skills:** Skills ship in `packages/autotel/skills/`, `packages/autotel-hono/skills/`, `packages/autotel-tanstack/skills/`, `packages/autotel-cloudflare/skills/`, `packages/autotel-subscribers/skills/`, `packages/autotel-edge/skills/`, and `packages/autotel-mcp/skills/`. Consumers run `npx @tanstack/intent install` in their project to set up skill-to-task mappings. Maintainers: run `pnpm intent:validate` to validate SKILL.md files; run `npx @tanstack/intent scaffold` for full domain discovery and skill generation.

---

## Package Structure

```
autotel/
├── packages/
│   ├── autotel/              # Core: trace, span, init, events, request logger, structured error
│   ├── autotel-edge/         # Edge runtimes (fetch, AsyncLocalStorage)
│   ├── autotel-cloudflare/   # Cloudflare Workers
│   ├── autotel-tanstack/      # TanStack Start
│   ├── autotel-hono/         # Hono middleware
│   ├── autotel-mcp/          # MCP instrumentation
│   ├── autotel-subscribers/   # Event subscribers (PostHog, etc.)
│   └── ...
├── docs/
│   ├── DEVELOPMENT.md
│   ├── ARCHITECTURE.md
│   ├── CONFIGURATION.md
│   └── AGENT-GUIDE.md        # Detailed review checklist, before/after examples
└── apps/                     # Example apps
```

Package-specific details: see each package’s `CLAUDE.md` (e.g. `packages/autotel/CLAUDE.md`).

---

## Core API (for suggesting user code)

When the user wants observability, suggest these entry points. All from `autotel` unless noted.

| Need                        | API / entry point                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Wrap a function with a span | `trace(fn)`, `span(name, fn)`, `instrument({ key, fn })`                                         |
| Request-scoped attributes   | `getRequestLogger(ctx?)` → `.set()`, `.info()` / `.warn()` / `.error()`, `.emitNow()`            |
| Structured throw            | `createStructuredError({ message, why?, fix?, link?, status?, code?, cause? })`                  |
| Parse API errors (client)   | `parseError(err)` → `{ message, status, why?, fix?, link?, raw }`                                |
| Product/analytics events    | `track(name, attributes)` or `Event` from `autotel/event`                                        |
| Init (once at startup)      | `init({ service, ... })` from `autotel` or `autotel/instrumentation`                             |
| Testing                     | `createTraceCollector()` from `autotel/testing`; `InMemorySpanExporter` from `autotel/exporters` |

- **Request logger** requires an active span (or explicit `TraceContext`). So wrap HTTP handlers with `trace()` (or framework middleware that creates a span), then call `getRequestLogger()` inside.
- **Structured errors**: Prefer `createStructuredError` over `new Error()` in API routes and services. On the client, use `parseError(caught)` to show message/why/fix in UI.

---

## Framework Quick Reference (for suggesting setup)

| Framework              | Where to look / what to suggest                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Hono**               | `autotel-hono`: middleware that creates span per request; use `trace()` or request logger inside handlers.  |
| **Fastify**            | Example: `apps/example-fastify`; init + span per request (or middleware); `getRequestLogger()` in handlers. |
| **TanStack Start**     | `autotel-tanstack`: middleware, env; see package CLAUDE and `apps/example-tanstack-start`.                  |
| **Cloudflare Workers** | `autotel-cloudflare`: init and wrap handlers; see package CLAUDE.                                           |
| **Next.js**            | Use `autotel` init and `trace()`/request logger in API routes / server components.                          |
| **Express**            | Middleware that creates a span per request; then `getRequestLogger()` in route handlers.                    |

Always suggest `init()` (or instrumentation) once at app entry; then spans + request logger or `trace()` in handlers.

---

## Invariants (do not break)

- **Synchronous init**: `init()` must stay synchronous. Use `node-require` helpers for optional/dynamic imports, never `await import()` for init-time loading.
- **Tree-shaking**: Packages use explicit `exports` in `package.json`. Do not add barrel re-exports that pull in unused modules.
- **Test split**: Unit tests `*.test.ts`; integration tests `*.integration.test.ts` (separate config in core package).
- **No secrets**: Never commit API keys, tokens, or secrets. Do not log sensitive data in examples or docs.

---

## Instrumentation Review Checklist (when reviewing or writing code)

Use this when adding or reviewing instrumentation in a codebase that uses Autotel.

### Traces and spans

- [ ] Handlers / entry points wrapped with `trace()` or equivalent span creation (e.g. framework middleware).
- [ ] Nested operations use `trace()` or `span()` where they represent a meaningful unit of work.
- [ ] Span names are meaningful (inferred from function/variable name or explicit `instrument({ key })`).
- [ ] Important context is set via `ctx.setAttribute()` or request logger `.set()`.

### Request-scoped context

- [ ] When “one snapshot per request” is needed, use `getRequestLogger(ctx?)` and call `.set()`, `.info()`/`.warn()`/`.error()` as the request runs; call `.emitNow()` (or rely on middleware) at the end.
- [ ] Request logger is only used inside an active span (or with explicit `TraceContext`).

### Errors

- [ ] API and service errors use `createStructuredError({ message, why?, fix?, link?, status?, cause? })` instead of `new Error()` where useful for debugging and UX.
- [ ] Client-side: API errors are parsed with `parseError(err)` and message/why/fix/link shown in UI (toast, banner, etc.).
- [ ] When recording errors on a span, use `recordStructuredError()` or the request logger’s `.error()`.

### Events (product/analytics)

- [ ] User/business events use `track(name, attributes)` or the Event API, not raw console or ad-hoc HTTP.

### Anti-patterns

- [ ] No raw `console.log` for request/response or business context when request logger or span attributes are available.
- [ ] No `throw new Error('...')` when structured context (why, fix, link) would help.
- [ ] No `await import()` for init-time optional dependencies; use `node-require` helpers.
- [ ] No logging of secrets, tokens, or full PII; use redaction or omit.

---

## Suggested Review Comments (for PRs or suggestions)

Use these when suggesting changes to user code:

**Missing instrumentation**

> Add a span for this handler with `trace()` (or the framework’s Autotel middleware), then use `getRequestLogger()` to attach request-scoped context and call `.emitNow()` at the end.

**Generic error**

> Use `createStructuredError({ message, status, why, fix, link, cause })` from `autotel` so the error is machine-parseable and the client can show message/why/fix via `parseError()`.

**Client not using structured error**

> On the client, use `parseError(err)` from `autotel` and show `error.message`, `error.why`, and `error.fix` in your toast/error UI.

**Scattered logging**

> Replace multiple logs with a single request-scoped snapshot: use `getRequestLogger()` and `.set()` throughout the request, then `.emitNow()` (or rely on middleware) so one coherent snapshot is emitted per request.

**Wrong import or init**

> Use `init()` from `autotel` (or `autotel/instrumentation`) once at startup. Use `trace` / `span` / `instrument` and `getRequestLogger` from `autotel`. See `packages/autotel/package.json` exports for the exact subpaths.

---

## Where to Go Deeper

- **Before/after examples, when to use what, framework snippets**: `docs/AGENT-GUIDE.md`
- **Cloudflare package direction and DX target**: `docs/CLOUDFLARE-DX.md`
- **Code patterns and architecture**: `docs/ARCHITECTURE.md`
- **Config and env**: `docs/CONFIGURATION.md`
- **Development and testing**: `docs/DEVELOPMENT.md`
- **Per-package entry points and patterns**: `packages/<name>/CLAUDE.md`

---

## Summary: Making Autotel the Right Fit for AI Coding Agents

1. **Single source of truth**: This file (AGENTS.md) — keep it updated when patterns or rules change.
2. **Clear API surface**: Suggest `trace` / `span` / `instrument`, `getRequestLogger`, `createStructuredError` / `parseError`, `track` / Event API, and `init()`; point to package exports for subpaths.
3. **Structured errors**: Always prefer structured errors and `parseError()` on the client so agents and users get explainable, actionable errors.
4. **Review checklist**: Use the instrumentation checklist and anti-patterns above when reviewing or generating code.
5. **Consistent suggestions**: Use the suggested review comments so recommendations are consistent and copy-paste friendly.
6. **Discoverability**: Point to AGENT-GUIDE.md and package CLAUDE.md files so the agent knows where to find examples and touchpoints for new integrations.
