# Gate actions, not just merges

An agent decides at runtime, so the interesting controls run at runtime too.
Two gates stand in this example, one inside a run and one between runs. Both
refuse something, and both refusals are on the record: a refusal nobody can see
is indistinguishable from a bug.

## The gate inside the run

```bash
pnpm start
```

An agent decides the answer is one more search away, and searches for the same
thing forever. A guard watches the run and stops it:

```
Runaway agent: 3 searches, acted: false
  stopped by spin-loop:3/6: step "search_policy" repeated 3× in last 6
Session cost when it stopped: $0.0099
```

The rules are `spinLoop`, `costCeiling` and `maxToolCalls`. They are pure
functions over the run's accumulated state, so the kill-switch needs no model
in the loop, and the stop lands on the trace as `gen_ai.guard.stopped` plus a
`gen_ai.guard.stop` event naming the rule, the observed value and the limit.

Then two supervised runs, one declined by a human and one approved.
`recordHumanApproval` records the outcome and, importantly, the **evidence**:
`observed` when the process saw the decision, `inferred` when the caller did
not say. An approval reconstructed from "the tool ran after a prompt" is not a
human decision and must not be filed as one.

The script asserts the runaway never reached the refund, that the spin-loop
rule is the one that fired, and that exactly one refund completed across three
runs.

## The gate between runs

```bash
pnpm start:evolution
```

A system that learns from its own traces needs a fitness function, or it does
not improve, it drifts. Here the fitness function is the eval suite and the bar
is the released procedure:

```
Baseline v1: 75%
Candidate v2: 63% (failed: over-limit, boundary-amount, boundary-days)
Candidate v3: 100%

Shipped: v3
```

Every case of every version leaves a `gen_ai.evaluation.result` event, so a
regression is a query rather than a rerun. The gate itself is a
`recordPolicyDecision` carrying `policy.decision`, the two pass rates, and the
cases that broke, with `governance.review_required` set on the refusal so a
rejected candidate goes to a person instead of a bin.

Evolution is a deployment. It flows through the same machinery as one.
