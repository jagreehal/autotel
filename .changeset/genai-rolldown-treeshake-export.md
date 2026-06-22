---
'autotel-genai': patch
---

Fix corrupt `autotel-genai` build that broke importing `autotel-genai/agent`.

rolldown 1.1.0 (via tsdown) inlined every static property read of a re-exported
`as const` object (e.g. `AGENT_PLAN_RISK_ATTR`), dropped the now-unreferenced
declaration, yet kept the symbol in a chunk's export list — producing
`SyntaxError: Export 'X' is not defined in module` at import time. The breakage
was non-deterministic across platforms, surfacing in CI as
`agentContextFromSpan is not a function` in `autotel-cloudflare`.

Tree-shaking is disabled for this package as a workaround (~10KB of retained
internal code; consumer tree-shaking is unaffected since subpath exports remain).
