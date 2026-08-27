# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## For AI Coding Agents

When suggesting or reviewing **instrumentation** (traces, request context, errors, events) in this repo or in codebases that use Autotel:

- **Read `AGENTS.md`**: single source of truth: core API, framework quick ref, invariants, review checklist, suggested review comments.
- **Use `docs/AGENT-GUIDE.md`**: before/after examples, when to use trace/span/request logger/structured error, framework setup snippets, touchpoints for new integrations.

Together these make Autotel easy for AI agents to recommend correctly and consistently.

## Overview

Autotel is a monorepo containing multiple packages that provide ergonomic OpenTelemetry instrumentation for Node.js and edge runtimes. The core philosophy is "Write once, observe everywhere" - instrument code a single time and stream observability data to any OTLP-compatible backend without vendor lock-in.

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup (bundling), vitest (testing)
- **Package Manager**: pnpm
- **Key Dependencies**: OpenTelemetry SDK, Node.js 22+, Edge runtimes (fetch, AsyncLocalStorage)

## Quick Commands

```bash
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm lint               # Lint all packages
pnpm format             # Format with Prettier
pnpm quality            # Full quality check (build + lint + format + type-check + test)
pnpm changeset          # Create a changeset
```

## Package Structure

- `packages/autotel` - Node.js core package (see `packages/autotel/CLAUDE.md`)
- `packages/autotel-edge` - Edge runtime foundation (see `packages/autotel-edge/CLAUDE.md`)
- `packages/autotel-cloudflare` - Cloudflare Workers (see `packages/autotel-cloudflare/CLAUDE.md`)
- `packages/autotel-mcp-instrumentation` - MCP instrumentation (see `packages/autotel-mcp-instrumentation/CLAUDE.md`)
- `packages/autotel-tanstack` - TanStack Start (see `packages/autotel-tanstack/CLAUDE.md`)
- `packages/autotel-subscribers` - Event subscribers and the `EventSubscriber` base (Mixpanel, Amplitude, Segment, Slack, Loki, file, webhooks). PostHog lives in `autotel-posthog` (see `packages/autotel-subscribers/CLAUDE.md`)
- `packages/autotel-genai` - GenAI/LLM instrumentation: canonical `gen_ai.*` semconv, cost, metrics, events, agents (see `packages/autotel-genai/CLAUDE.md`)
- `packages/autotel-langfuse` - Langfuse compatibility: `langfuseCompatibility()` span enricher, `langfuseScores()`, `langfuseMedia()`. Depends on no Langfuse package: Langfuse ingests plain OTLP, so this only fills the gaps OTel conventions do not cover (see `packages/autotel-langfuse/CLAUDE.md`)
- `packages/autotel-posthog` - **Every PostHog surface.** Browser join: `joinPostHog()` (one call, both directions), `posthogCompatibility()` span enricher (session id, person, replay link on failed spans, named feature flags), `autotelBeforeSend()` so PostHog events carry `$trace_id`. Server: `PostHogSubscriber` on `autotel-posthog/subscriber` (moved out of `autotel-subscribers`). Depends on no PostHog package for the browser half: the API is read structurally, guarded for the snippet stub and the not-yet-initialized instance (see `packages/autotel-posthog/CLAUDE.md`)
- `packages/autotel-agents` - Coding-agent observability: browser-safe domain layer that turns the OTel metrics + log events from Claude Code / opencode / Codex into a session model (adapter registry, reducers, MCP/sub-agent/skill taxonomy). Consumed by the autotel-devtools Agents tab (see `packages/autotel-agents/README.md`)
- `packages/autotel-schema` - Telemetry surface as a typed, versioned contract: declare spans/attributes, validate live spans, diff for breaking changes (see `packages/autotel-schema/CLAUDE.md`)
- `packages/autotel-message-contract` - Optional, standalone, test-time adjacent: brokerless message contract testing: pin serialized message shape + backward/forward version compatibility as unit tests (see `packages/autotel-message-contract/CLAUDE.md`)
- `packages/autotel-webmcp` - Browser WebMCP instrumentation: traces imperative tool registration and execution through the shared ModelContext; payload capture is opt-in and shared tool attributes use canonical `gen_ai.*` / `mcp.*` names

## Documentation

- **Development**: `docs/DEVELOPMENT.md` - Commands, testing, workflows
- **Architecture**: `docs/ARCHITECTURE.md` - Code patterns, conventions, structure
- **Advanced Features**: `docs/ADVANCED.md` - Advanced features (v1.1.0+)
- **Configuration**: `docs/CONFIGURATION.md` - Environment variables, YAML config
- **Security Observability**: `docs/SECURITY-OBSERVABILITY.md` - Security events, signals, detection rules, OWASP mapping

## Boundaries

- ✅ **Always do**: Follow TypeScript 5.0+ decorators, use `node-require` helpers for dynamic imports, maintain tree-shaking
- ⚠️ **Ask first**: Breaking changes, new dependencies, modifying build configs
- 🚫 **Never do**: Use `await import()` for dynamic loading, modify `node_modules/`, commit secrets, break tree-shaking

## Key Patterns

- **Functional API**: `trace()`, `span()`, `instrument()` wrap business logic
- **Tree-shaking**: All packages use explicit exports in `package.json`
- **Synchronous init**: `init()` must remain synchronous (use `node-require` helpers)
- **Test separation**: Unit tests (`.test.ts`) vs integration tests (`.integration.test.ts`)

For detailed information, see the documentation files listed above or package-specific CLAUDE.md files.
