# Can you reconstruct the decision from the trace alone?

Classical software fails loudly: exception, stack trace, line number. An
agent's worst failures return 200, fluent and wrong. There is no stack trace
for a bad decision, so the trace has to carry what the decision was made from.

The test: if a reviewer, an auditor, or an eval harness cannot reconstruct why
the agent did what it did from the trace alone, the trace is a log wearing the
wrong badge.

This example runs that test twice.

```bash
pnpm start
```

A support agent answers a refund ticket. Its first draft cites no policy, a
check rejects it, the retry carries the complaint back as context, the second
draft passes, and the agent issues the refund. Then
[`src/reviewer.ts`](src/reviewer.ts) is handed the exported spans and the
events that carry their trace ids, and nothing else. It answers:

```
  Which model ran, and which version of the agent?
    claude-sonnet-4-6-20251101 answered as claude-sonnet-4-6-20251101, agent 2026-08-29.1

  What context did the model see when it chose?
    ["Can I get a refund on my £240 order...","policy refunds-v4: ...","Rejected: answer cites no policy. Redo and cite the policy."]

  How many tokens, and what did the run cost?
    296 in, 49 out, $0.001623 across 2 calls

  Which checks judged the answer, and how did they score it?
    cites-policy=fail (answer cites no policy), cites-policy=pass (answer cites a policy)

  Was there a retry, and what did it change?
    attempt 2 after: answer cites no policy

  Which tool ran, and can its arguments be tied to its result?
    issue_refund complete, input sha256:bc9d0 → output sha256:c514a

  Where did the run get to before it acted?
    retrieve → draft → draft-retry
```

The same work instrumented as a span and four log lines answers 0 of 8. Both
results are asserted, so the example fails if either claim stops holding.

## What produces each answer

| Question                 | Where it comes from                                                    |
| ------------------------ | ---------------------------------------------------------------------- |
| Model and agent version  | `traceGenAI` request/response attributes, `traceWorkflow({ version })` |
| Context in, output out   | `setGenAiContent`, which is opt-in because content can carry PII       |
| Tokens and cost          | `recordGenAiUsage`, which prices the call through `estimateLLMCost`    |
| Checks and scores        | `recordEvaluationResult` on the step that ran the draft                |
| The retry and its reason | step attributes on the retry span                                      |
| Tool call                | `defineAgentToolCall`, which audits the call and force-keeps its trace |
| Checkpoints              | `traceStep`, one span per step with its index                          |

Two details worth knowing before you copy this.

**Tool arguments are hashed, not attached.** `tool.input_hash` and
`tool.output_hash` prove which arguments produced which result without shipping
a customer's data to your telemetry backend. Raw capture is a separate, opt-in
decision.

**Evaluation results are events, not attributes.** They travel through a
subscriber and carry the trace and span id of the step that emitted them, which
is how the reviewer joins a failing score back to the answer that earned it.
With no subscriber configured the event is dropped, and `track()` warns once to
say so.
