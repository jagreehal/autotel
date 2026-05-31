---
'autotel-devtools': minor
---

Add a **Flow** view: a per-trace call graph that unifies AI tool calls, LLM calls and plain functions into one picture of what a run did.

- New `Flow` tab (full-page + embedded panel) rendering a top-to-bottom node graph with `__start__`/`__end__` bookends, role-coloured nodes (entry / LLM / AI tool / function / db / http), and repeated calls collapsed into a single node with a count and error ratio (e.g. `calculate 4/5`).
- Selecting a node opens an input/output panel that renders functions and AI tools identically — AI tools from `ai.toolCall.args/result`, plain functions from the `autotel.input`/`autotel.output` capture convention, with sensible fallbacks for db/http.
- LLM economics: nodes and a per-trace header chip show token counts and USD cost, sourced from the canonical GenAI pricing layer. AI-SDK wrapper aggregates (`ai.streamText`) are counted once rather than double-counted with their `doStream` children.
- Pure, unit-tested graph layer (`flow/flow.ts`): span classification, I/O extraction, repeat-collapsing graph build, per-node metric aggregation, and BFS/barycenter layout.
- Shared `JsonField` and token/cost formatters so the Flow view, the GenAI view, and the ToolCallCard render I/O and economics from one place.
