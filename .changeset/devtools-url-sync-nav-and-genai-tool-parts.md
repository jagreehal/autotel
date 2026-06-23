---
'autotel-devtools': minor
---

Shareable URLs, cross-navigation, and canonical GenAI tool parts in the
full-page UI.

- **URL state sync (full-page only):** the current tab, selected trace/span, the
  traces-list filters (search, status, min-duration, sort), and the GenAI search
  are reflected in the location hash
  (`#tab=genai&trace=<id>&span=<id>&q=…&status=error&min=…&sort=duration:asc&gq=…`),
  so any view — including a filtered list — can be bookmarked or shared by
  copying the URL, and opening such a URL restores it exactly. Uses
  `replaceState` (clean history, no write→read loop) and reacts to manual hash
  edits. The embedded widget never touches the host page's URL.
- **Navigable span IDs:** in the span detail panel, Trace ID jumps to the
  trace's root span and Parent Span ID navigates to the parent span (the
  currently-selected Span ID stays plain). Copy buttons are unchanged.
- **GenAI view:** the `trace …` reference in the model header is now a link that
  opens the trace in the Traces waterfall, focused on that span.
- **Span detail panel:** cross-trace span links (`span.links`) are now clickable
  and open the linked span in the waterfall.
- **GenAI tool parts:** canonical `gen_ai` `tool_call` / `tool_call_response`
  message parts (whose data lives in `name`/`arguments`/`response`, not
  `content`) now hydrate into tool-call chips and result values instead of
  rendering as empty bubbles, matching how the Vercel `tool-call`/`tool-result`
  shape is handled.

Internally, the selected span and the traces/GenAI list filters are now global
signals (previously local component state / a one-shot deep-link), which is what
lets a single writer serialize the full view into the URL without clobbering.
