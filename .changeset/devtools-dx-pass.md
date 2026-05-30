---
"autotel-devtools": minor
---

Devtools DX pass:

- **Theming**: functional light/dark/system theme driven by `data-theme` + CSS custom-property tokens (`--at-*` mapped into Tailwind `@theme`), with a theme cycle toggle and `localStorage` persistence. Storybook gains a Theme toolbar so every story is viewable in both modes.
- **JSON attribute viewer**: span attributes that are JSON objects/arrays (e.g. `gen_ai.input.messages`) now render as a collapsible, syntax-coloured tree instead of one long line. Reliable detection (try-parse, object/array only) falls back to the raw value for scalars and invalid JSON.
- **Keyboard shortcuts**: centralised the `?` help modal into a single source of truth, fixing a bug where two help dialogs could stack. Context-aware shortcut lists for the trace list and trace detail.
- **Span detail**: the attributes panel is now vertically resizable; the fullscreen value button is reachable (it previously had no `group` hover ancestor).
- **Waterfall**: time-axis labels are responsive — marker count adapts to the column width and the first/last labels are edge-aligned, so they no longer collide in a narrow pane.
- **Sub-millisecond precision**: fixed OTLP parsing truncating durations to whole milliseconds — fast spans (<1ms) now keep microsecond precision instead of showing `0ms`.
- **Critical path**: the waterfall highlights the span chain that determines total trace latency (toggleable), pointing straight at the bottleneck.
- **Self time**: span detail shows exclusive duration (span time minus children, interval-unioned) so you can tell a slow span from a slow subtree.
- **Trace sorting**: sort the trace list by time / duration / span count / service / name / status to surface the slowest or largest traces.
- **Min-duration filter**: filter the trace list to traces at least N ms long.
- **Instrumentation scope**: span detail shows the emitting instrumentation name/version (parsed from OTLP `scope`).
- **Service map redesign**: per-service pastel node fills with soft shadows, bold names, and `N spans · N err` subtitles; connection edges now show always-on labels (`1× · 900ms`, `2× · 50% err · 150ms`) with filled arrowheads and dashed red error edges — keeping the type-coded shapes (DB cylinder, messaging hexagon).
- **Service map bug fixes**: (1) CLIENT-span connections used `inferResourceName` for the source, which resolved to the *peer* and collapsed source==target so no edges ever rendered — the caller is now the span's own resource service; (2) SVG presentation attributes were written camelCase (`strokeWidth`, `strokeDasharray`, `markerEnd`, `textAnchor`), which Preact passes through verbatim and SVG ignores, so arrowheads, dashes, stroke widths, and text centring never applied — all converted to kebab-case.
- **Design system pass**: introduced a typography duality — **Hanken Grotesk** for UI chrome, **JetBrains Mono** reserved for data (IDs, durations, attributes, code) — replacing the previous monospace-everything UI. Reworked the theme tokens into an **OKLCH** system with neutrals subtly tinted toward the brand hue (no pure black/white), and added restrained, reduced-motion-aware entrance animations for modals. Recorded the design context in `.impeccable.md`.
- **Trace list redesign**: replaced the tall cards with a dense, scannable table — sortable column headers (Service, Operation, Duration, Spans, Time, Status) that drive the multi-axis sort directly, aligned monospace metrics, status badges, and per-service colour pills that match the service-map node colours. The columns are **container-responsive** (Spans + Time drop first) so it stays usable in a narrow docked widget without horizontal scroll.
- Removed the unused `react-json-view-lite` dependency.
