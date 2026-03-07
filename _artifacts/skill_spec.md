# Autotel — Skill Spec

Autotel is an ergonomic OpenTelemetry instrumentation library for Node.js and edge runtimes. It provides trace(), span(), instrument(), getRequestLogger(), createStructuredError/parseError, and track()/Event API so developers instrument once and stream observability to any OTLP-compatible backend.

## Domains

| Domain | Description | Skills |
|--------|-------------|--------|
| Instrumentation | Traces, spans, init, configuration | autotel-core, autotel-instrumentation |
| Request context | One snapshot per request | autotel-request-logging |
| Errors | Structured errors and client parseError | autotel-structured-errors |
| Events | Product/analytics events and subscribers | autotel-events |
| Framework integration | Hono, Fastify, TanStack, Cloudflare | autotel-frameworks |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
|-------|------|--------|----------------|---------------|
| autotel-core | core | instrumentation | When to use what, init, exports | 3 |
| autotel-instrumentation | core | instrumentation | trace, span, instrument, init | 2 |
| autotel-request-logging | core | request-context | getRequestLogger, emitNow | 1 |
| autotel-structured-errors | core | errors | createStructuredError, parseError | 2 |
| autotel-events | core | events | track, Event, subscribers | 1 |
| autotel-frameworks | framework | framework-integration | Hono, Fastify, TanStack, Cloudflare | 1 |

## Recommended Skill File Structure

- **Core skills:** autotel-core, autotel-instrumentation, autotel-request-logging, autotel-structured-errors, autotel-events (all in packages/autotel/skills/)
- **Framework skill:** autotel-frameworks (in packages/autotel/skills/; references autotel-hono, autotel-tanstack, autotel-cloudflare packages)
- **Flat structure:** Each skill in packages/autotel/skills/<slug>/SKILL.md

## Note

This spec was generated as a draft without the full maintainer interview. Run `npx @tanstack/intent scaffold` and complete Domain Discovery (Steps 1–2) for interview-driven refinement.
