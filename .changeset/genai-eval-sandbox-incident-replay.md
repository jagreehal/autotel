---
'autotel-genai': minor
---

Eval-sandbox incident replay: cross-agent shared-channel detection, run identity, honey tokens, and span forensics

New helpers under `autotel-genai/agent` for the case where several eval agents
share a writable resource and start coordinating through it:

- `detectCrossAgentPattern()` — pure function that groups events by the shared
  resource (or memory isolation key) and flags a resource touched by more than
  `minAgents` distinct agent identities inside a sliding window.
  `crossAgentDetectionsToSecurityEvents()` maps detections to `autotel-audit`
  `securityEvent` payloads, and `CrossAgentMonitor` runs the same detection live
  as tools execute, emitting each resource only once.
- `recordEvalRunIdentity()` + `EVAL_IDENTITY_ATTR` — stamp `eval.run_id`,
  `eval.task_id` and `eval.sandbox_id` so runs stay separable downstream.
- `createHoneyTokenTool()` — a decoy credential tool that emits a critical
  security event when an agent touches it.
- `querySpansForEvalIncident()` + `spansToCrossAgentEvents()` — batch forensics
  over an exported span array: policy denials, elevated plan risk,
  exfil-capable actions, and cross-agent alerts.

Shared-registry access is grouped by the registry path, deliberately **not** by
the calling sandbox. Two isolated sandboxes reaching one registry is the breach
being looked for, so keying the group by the caller would give each run its own
group and the detector could never fire. The caller stays identifiable through
`agentId`.

Security events use the `llm` category and `error` severity — `autotel-audit`'s
`SecurityEventCategory` has no `agent` member and `SecuritySeverity` is
`info | warning | error | critical`, so the agent framing lives in the event name
and `targetType` instead.

The package's TypeScript `lib` moves from `ES2022` to `ES2023`, matching core
`autotel` and the other packages that already use `Array#toSorted`. `target`
is unchanged, so emitted output is identical.
