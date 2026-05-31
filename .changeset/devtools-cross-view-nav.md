---
'autotel-devtools': minor
---

Cross-view navigation, connection status, and Flow keyboard control.

- **Deep-link to a span**: a global `selectedSpanIdSignal` plus `openSpanInWaterfall(traceId, spanId)` let any view jump to a specific span in the Traces waterfall. The Flow detail panel and the GenAI span view now have an "Open in Traces" button; the waterfall expands collapsed ancestors and scrolls the target into view.
- **Connection status**: the receiver connection state (connected / connecting / disconnected) is now shown — a labelled dot in the full-page sidebar and a compact dot in the embedded panel header — so "no data yet" is distinguishable from "not connected".
- **Flow keyboard navigation**: with the graph focused, arrow keys move between nodes (left/right within a layer, up/down to the nearest node in the adjacent layer), Enter opens the node in Traces, and Esc deselects.
