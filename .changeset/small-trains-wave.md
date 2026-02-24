---
'autotel-cloudflare': minor
'autotel-edge': minor
---

Add first-class Cloudflare Workflows instrumentation.

- `autotel-edge` now exports `WorkflowTrigger` and includes it in the `Trigger` union.
- `autotel-cloudflare` `instrumentWorkflow()` now passes a workflow trigger into config resolution and emits spans for `run`, `step.do`, and `step.sleep` with `workflow.instance_id` and cold start attributes.
