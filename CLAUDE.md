# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Overview

Autotel is a monorepo containing multiple packages that provide ergonomic OpenTelemetry instrumentation for Node.js and edge runtimes. The core philosophy is "Write once, observe everywhere" - instrument code a single time and stream observability data to any OTLP-compatible backend without vendor lock-in.

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup (bundling), vitest (testing)
- **Package Manager**: pnpm
- **Key Dependencies**: OpenTelemetry SDK, Node.js 18+, Edge runtimes (fetch, AsyncLocalStorage)

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
- `packages/autotel-mcp` - MCP instrumentation (see `packages/autotel-mcp/CLAUDE.md`)
- `packages/autotel-tanstack` - TanStack Start (see `packages/autotel-tanstack/CLAUDE.md`)
- `packages/autotel-subscribers` - Event subscribers (see `packages/autotel-subscribers/CLAUDE.md`)

## Documentation

- **Development**: `docs/DEVELOPMENT.md` - Commands, testing, workflows
- **Architecture**: `docs/ARCHITECTURE.md` - Code patterns, conventions, structure
- **Advanced Features**: `docs/ADVANCED.md` - Advanced features (v1.1.0+)
- **Configuration**: `docs/CONFIGURATION.md` - Environment variables, YAML config

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
