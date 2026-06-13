---
'autotel-devtools': patch
---

GenAI view: token-breakdown labels and named tool steps in the tour.

- The model detail header now spells out the **cached** and **reasoning** share of token usage inline — `176 (100 cached) → 90 (32 reasoning)` — instead of only a cached percentage, so the reasoning-token count is visible where the call is inspected.
- The guided tour's planning step now **names the tools** the model requested: "Model calls getWeather (x3)" rather than the generic "Model decides what to do", falling back to the generic title when a provider signals the decision only via a finish reason (no structured tool calls to name).

New shared formatters in `widget/utils/genaiFormat`: `formatInputTokens`, `formatOutputTokens`, and `summarizeToolCalls` (collapses repeats into `name (xN)`, truncates long lists).
