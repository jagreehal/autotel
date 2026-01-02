---
'autotel-subscribers': minor
'autotel-cloudflare': minor
'autotel-backends': minor
'autotel-tanstack': minor
'autotel-plugins': minor
'autotel-edge': minor
'autotel-aws': minor
'autotel-mcp': minor
'autotel-web': minor
'autotel-terminal': minor
'autotel': minor
---

Add new span processors, exporters, terminal dashboard, and type-safe attributes module

**autotel:**

- Add `PrettyConsoleExporter` for colorized, hierarchical trace output in the terminal
- Add `FilteringSpanProcessor` for filtering spans by custom criteria
- Add `SpanNameNormalizer` for normalizing span names (removing IDs, hashes, etc.)
- Add `AttributeRedactingProcessor` for redacting sensitive span attributes
- Export new processors via `autotel/processors` and `autotel/exporters`
- Add new `autotel/attributes` module with type-safe attribute helpers:
  - Key builders: `attrs.user.id()`, `attrs.http.method()`, etc.
  - Object builders: `attrs.user.data()`, `attrs.db.client.data()`, etc.
  - Attachers: `setUser()`, `httpServer()`, `identify()`, `setError()`, etc.
  - PII guardrails: `safeSetAttributes()` with redaction, hashing, and validation
  - Domain helpers: `transaction()` for business transactions
  - Resource merging: `mergeServiceResource()` for enriching resources
- Fix ESLint config to disable `unicorn/number-literal-case` (conflicts with Prettier)

**autotel-terminal (new package):**

- React-ink powered terminal dashboard for viewing traces in real-time
- Live span streaming with pause/resume functionality
- Error filtering and statistics display
- Auto-wires to existing tracer provider

**autotel-subscribers:**

- Fix `AmplitudeSubscriber` to correctly use Amplitude SDK pattern where `init()`, `track()`, and `flush()` are separate module exports

**Examples:**

- Add Next.js example app
- Add TanStack Start example app
