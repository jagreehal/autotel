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
'autotel': minor
---

Add new span processors, exporters, and terminal dashboard

**autotel:**
- Add `PrettyConsoleExporter` for colorized, hierarchical trace output in the terminal
- Add `FilteringSpanProcessor` for filtering spans by custom criteria
- Add `SpanNameNormalizer` for normalizing span names (removing IDs, hashes, etc.)
- Add `AttributeRedactingProcessor` for redacting sensitive span attributes
- Export new processors via `autotel/processors` and `autotel/exporters`

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
