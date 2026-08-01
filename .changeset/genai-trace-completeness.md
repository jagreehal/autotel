---
'autotel-schema': minor
---

Score whether a GenAI trace still tells the whole agent story.

**`scoreGenAiCompleteness(spans)`** scores one trace 0–10 across the ten fields
root-cause analysis actually needs: LLM input and output, model name, token
usage, cost, per-span latency, tool call arguments and results, an intact span
tree, and a plausible span count. Half a point where a field is present but
partial — token usage recorded in one direction only, tool calls whose results
never landed, parent ids that resolve to no span, a single-span trace.

These are the fields agent-observability platforms are themselves benchmarked
on; a trace that loses them is unanalysable regardless of which backend it lands
in. Dependency-free like the rest of the package, and it takes the same
`ScenarioSpan` input as `scenario.ts`, so a `test-span-collector` trace feeds
straight in.

```typescript
import { scoreGenAiCompleteness, formatCompleteness } from 'autotel-schema';

const result = scoreGenAiCompleteness(collector.peekTrace(traceId));
if (result.score < 8) throw new Error(formatCompleteness(result));
```
