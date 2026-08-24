---
'autotel': minor
'autotel-genai': minor
'autotel-schema': minor
'autotel-agents': minor
'autotel-devtools': minor
'autotel-mcp-instrumentation': minor
'autotel-cli': minor
'autotel-mongoose': minor
'autotel-cloudflare': patch
---

Say what a trace could not see, and what a sequence of calls means.

A trace that lost a fact and a trace that never could capture it look identical
once they reach a backend — both read as complete, because the timeline has a
start and an end. These packages now narrow that claim in-band, on the spans
themselves.

**Evidence quality** (`autotel/evidence`). `recordEvidence()` labels one field
(`observed` / `inferred` / `estimated` / `truncated` / `redacted` / `absent` /
`unobservable`); `captureCoverageAttributes()` declares which capture surfaces a
process observes at all. No label means unknown — nothing here asserts
completeness. The lossy paths now announce themselves: truncated captures set
`autotel.evidence.input|output`, `recordLLMCost()` labels its figure `estimated`
(or `unobservable` when no pricing matched) so a price-table number is never
mistaken for a bill, and `sanitizeAuditPayloadWithEvidence()` reports what a
privacy profile removed, with the counts covered by the audit event hash.

**Approvals say whether anyone saw them.** `recordHumanApproval()` stamps
`agent.consent.evidence`, defaulting to `inferred`: no runtime reports the
human's click, so most approvals are deduced from the tool having run, and that
deduction must never be citable as a human decision.

**Sequence detection** (`autotel-genai/agent`). Ordered steps within one
session: `denied-then-executed` requires the denial to come first, and
reversed it does not fire. `emitSequenceDetections()` writes each finding as its
own correlated log record, and `recordDetectionDisposition()` records what a
human decided — refusing to close a finding as `false_positive` or
`risk_accepted` without a written reason. Both sides carry the same flat
`detection.rule_id` / `detection.correlation_id` keys, which is what joins a
finding to a decision made hours later in a different trace.
`sequenceRulesToSigma()` generates SIEM rules from the same rule set.

**Context compaction** (`autotel-agents`, `autotel-devtools`). Agents replace
the conversation with a summary and carry on; nothing announces it, but the
token counts show the discontinuity. Detected per query-source lineage, ignoring
estimated token counts, surfaced on the Agents timeline as a boundary — not an
error, since compaction is the agent working correctly. `postCompactionRegression()`
reports whether the agent started re-reading what it had already seen.

**Also**: `mcp.security.manifest.digest` fingerprints a tool's text surface, so
a manifest rewritten after you trusted it reads as changed rather than merely
scanning clean; `scoreGenAiCompleteness()` distinguishes a missing field from
one the deployment cannot capture, with a `healthy`/`partial`/`unknown`/`invalid`
verdict; `autotel doctor --capture` reports which surfaces a project can observe
at all; and `autotel-mongoose` restores its Mongoose 8 peer range, which had
been ratcheting with its devDependency while the README always said 8+.
