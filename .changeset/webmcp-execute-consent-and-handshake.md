---
'autotel-webmcp': minor
'autotel-devtools': minor
---

Record why a WebMCP tool failed, stop substituting its result, and report the
consent the instrumentation cannot see.

- A handler that throws or rejects now puts `error.type` and
  `webmcp.result.error` on the execute span, plus `webmcp.error.message` when
  payload capture is on. Chrome replaces a thrown error with a generic
  `UnknownError` before the agent sees it, so the span is the only place the
  reason survives. The rejection still reaches the caller unchanged.
- The instrumentation no longer rewrites what the agent receives: a handler's
  string and `undefined` are handed back exactly as returned. Installing
  telemetry no longer changes application behaviour. Chrome's own substitution
  is still recorded in `webmcp.result.substituted`.
- Execute spans are named `execute_tool {gen_ai.tool.name}`, the GenAI
  convention `autotel-genai` already follows, rather than the constant
  `webmcp.tool.execute`. Anything matching the old span name needs updating;
  `gen_ai.tool.name` and `webmcp.tool.name` are unchanged.
- New `webmcp.consent` span, emitted by `recordConsent()` on the handle
  `instrumentWebMCP()` returns. The consent dialogue is host UI and invisible to
  code that patches `registerTool`, so the host reports it and the label the
  human read lands on the same trace as the call that ran, with
  `webmcp.consent.mismatch` when the two disagree.
- New `webmcp.execute.depth` and `webmcp.execute.parent`: a handler that calls
  another tool spends one consent on two calls, and the second shows up here.
- New `isRefusal` option, so a host whose tools refuse in their own words is not
  left with the default two-English-sentence match, and `fingerprintHandler`
  (off by default), which folds the handler source into
  `webmcp.tool.descriptor` so a swap that changes only the function sets
  `webmcp.tool.redefined`.
- Handshake facts on registration spans — title vs name, descriptor
  fingerprint, execute sequence, known library refusals — surfaced on the
  devtools WebMCP tab.
