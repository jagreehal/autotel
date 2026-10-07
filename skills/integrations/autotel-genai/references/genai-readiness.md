# GenAI readiness

The skill covers how to emit each GenAI signal. This covers whether the set is
enough to explain an incident: a slow assistant, a broken tool, a provider
outage, a context blow-up, a cost spike. Load it when reviewing an AI path for
alerting or debugging, not for a first `traceGenAI` call.

## One span per logical operation

Before adding `traceGenAI` around a call, list what already emits GenAI spans
for it: the AI SDK bridge, an OpenInference / OpenLLMetry / LangChain hook, a
provider SDK hook. Pick one owner per operation (workflow, agent, model call,
tool, retrieval, memory, evaluation). Two owners give two `chat` nodes for one
call, double token totals and racing parents.

- Bridge owns it: keep the bridge, add only the workflow / agent context it
  lacks.
- App owns it: add the spans and turn the overlapping bridge off where the
  process starts (env, launch script, `NODE_OPTIONS`), not in a module that
  runs after the hook registered.

## Trace shape

```text
HTTP or job span
  invoke_workflow assistant_turn
    invoke_agent planner
      chat gpt-4o
      execute_tool search
      retrieval docs_index
      chat gpt-4o
```

- Every model call gets its own inference span (`{operation} {model}`) that
  opens before the provider request and closes after the response, the stream's
  last chunk, or the error. Tokens only on a workflow span is not inference
  coverage.
- Inference and tool spans are children of the workflow or agent, never
  siblings of it under the HTTP root. In callback- or stream-driven code
  (LangChain callbacks, SSE, async generators), capture the workflow context
  when the turn starts and start child spans from it; do not rely on whatever
  span is current when the callback fires.
- Setup and helper spans (memory store, checkpointer, DB session, stream
  writer) must not become the parent of model or tool spans.
- Per-turn aggregates (tokens, LLM calls, tool calls) go on the workflow span,
  not the HTTP root.
- Workflow and agent names come from the app's own identity (registered name,
  class, constant), not from the route or session. No stable name: leave the
  workflow uncovered rather than invent `assistant_agent`.

## Failure classes

`traceGenAI` sets `error.type` to the thrown error's name. Make that name a
stable class, so `gen_ai.client.operation.duration` splits usefully:
`timeout`, `rate_limit`, `provider_5xx`, `model_not_found`,
`model_unavailable`, `content_filter`, `tool_error`, `first_chunk_timeout`.
Map provider errors to these before rethrowing.

## Streaming

Keep the inference span open until the stream ends or fails. Record
`createStreamTimer` timing and `finishReasons`. A stream that never produced a
first chunk is a `first_chunk_timeout` failure on the workflow, not a silent
long span. Record how a stream closed (completed, client cancel, disconnect,
timeout) as a low-cardinality reason.

## Token and context pressure

One token histogram does not close a context-pressure gap. List each signal the
code can observe, and call the gap partial until all are present:

- input / output / cache tokens (`recordGenAiUsage`, `gen_ai.client.token.usage`)
- context budget used, as a percent (`contextBudget` guard rule)
- truncation count and token-limit errors (as an `error.type`)
- prompt / tool-schema size, as a metric bucket (span attributes alone are not
  an alert source)
- LLM calls and tool calls per turn (`maxSteps` / `maxToolCalls` guard state,
  or a counter on the workflow)

## Content capture

Classify each path: `disabled`, `metadata-only`, `redacted`, or `full`. Default
is no raw content. Turning on `setGenAiContent` needs an explicit opt-in, a
redaction hook, and a named retention owner. Sensitive fields:
`gen_ai.input.messages`, `gen_ai.output.messages`,
`gen_ai.system_instructions`, `gen_ai.retrieval.documents`,
`gen_ai.retrieval.query.text`, `gen_ai.tool.definitions`,
`gen_ai.tool.call.arguments`, `gen_ai.evaluation.explanation`. None of them,
and no conversation, user, tenant or request id, ever goes in a span name or a
metric attribute.

## Incident patterns → signals

| Pattern                       | Signal                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Slow or timing-out assistant  | workflow duration, `gen_ai.client.operation.duration` by provider/model/`error.type` |
| Provider outage or throttling | operation duration and `error.type` by provider, model, region                       |
| LLM or tool fan-out           | LLM and tool calls per turn, tokens per turn                                         |
| Broken tool                   | `execute_tool` outcome and duration by `gen_ai.tool.name` and failure class          |
| Slow first token              | `gen_ai.client.operation.time_to_first_chunk`, finish reason                         |
| Model or config mismatch      | request vs response model, prompt version (`promptVersion` / `promptHash`)           |
| Retrieval stale or empty      | empty-result rate, index version, last-ingest age, vector store outcome              |
| Quality regression            | `gen_ai.evaluation.result` (`recordEvaluationResult`), evaluator errors              |
| Cost spike                    | `gen_ai.client.cost.usd` and tokens by model/workflow; unpriced models flagged       |
| Safety or refusal spike       | refusal / content-filter outcome by policy class                                     |
