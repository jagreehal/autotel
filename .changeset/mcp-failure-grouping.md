---
'autotel-mcp-instrumentation': minor
---

Group MCP failures by cause, and stop re-classifying unchanged manifests every request

**Fixed: a client span stayed OK when the tool it called reported failure.**
`isError: true` arrives inside a well-formed result, so nothing throws and the
call was being marked successful — leaving the caller's half of the trace
claiming success while the server's own span already said ERROR. `callTool` now
sets `error.type=tool_error` and an ERROR status on that result, matching the
server, and its duration metric carries the error too.

**Fixed (behaviour change): the guard bridge was told every non-throwing call
succeeded.** The recorded step hardcoded `error: false`, so a tool reporting
`isError` counted as a success and an error-loop rule could never accumulate on
the failure mode MCP tools actually use. The step now carries the tool's own
verdict. **If you pass a `guard`, expect it to trip on runs it previously let
through** — that is the point, but it is a live enforcement change, not just a
reporting one.

**Added: `mcp.failure.category` and `mcp.failure.fingerprint`.** `error.type`
already said a call failed; nothing said whether ten failures were one bug ten
times or ten separate bugs. Every failure path is covered on both sides of the
trace — a handler or a call that throws, and an `isError` result produced or
received — including `resources/read` and `prompts/get`, whose transport
failures reject rather than returning `isError`. Both ends fingerprint identical
text identically, so one bug is one group whichever side recorded it.

The fingerprint is a hash of the failure text with run-specific values removed
(UUIDs, long hex runs, every digit run, quoted values), so two occurrences of one
cause agree on it across processes. That is the property that matters on a
stateless deployment: with no session to accumulate against, correlation has to
happen on something every span already carries, and this is on the span whichever
instance served the call.

- Classification runs on the **raw** text, never the normalised form —
  normalisation replaces digit runs, which would erase the `401`/`503` the
  channel patterns key on. Channels are ordered most-specific-first, so
  `504 Gateway Timeout` reads as `timeout` rather than `dependency`.
- Only the category reaches the duration metric. The fingerprint is one series
  per distinct bug and stays on the span, where the volume is already per-call.
- A failure with no text gets neither attribute. Fingerprinting the empty string
  would collapse every unrelated silent failure into one group, which reads as a
  single high-frequency bug that does not exist.
- `classifyFailure`, `fingerprintFailure`, `normalizeFailureMessage`,
  `extractFailureText` and `failureTextFromError` are exported, so the same
  grouping can be applied to failures this package does not wrap.

**Fixed: a `securityClassifier` was billed once per request instead of once per
manifest.** Manifest assessment happens at registration time, and `2026-07-28`
builds a server per request — so `instrumentMcpServer` runs per request too, and
every request re-classified descriptions that had not changed. With an LLM-backed
classifier that is per-request latency and spend on a constant. Assessments are
now memoised at module scope, the only scope that outlives the per-request server.

The memo is keyed by classifier first, then by the normalised manifest surface:
two configs may disagree about the same text, and a shared verdict would
attribute one classifier's security finding to the other. A changed description
re-classifies, so a redeploy that edits a manifest is still caught.
