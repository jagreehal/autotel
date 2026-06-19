# example-langchain-observer

Capture **LangChain / LangGraph + Ollama** runs as canonical `gen_ai.*`
OpenTelemetry spans, using `autotel-genai`'s event-stream observer.

One `createLangChainObserver` handler bridges every LangChain callback
(`runId` / `parentRunId`) into `createGenAiObserver`, which rebuilds the span
tree, estimates cost, and force-closes abandoned children. An in-memory
exporter then prints what was captured — proving the glue works end to end
against a real local model.

```ts
const observe = createGenAiObserver({ tracer, exportContent: (e) => e });
const handler = createLangChainObserver(observe);

await agent.invoke(input, { callbacks: [handler] }); // ← the only wiring needed
```

## Run it

```bash
ollama serve           # in another terminal
ollama pull llama3.2

pnpm --filter @jagreehal/example-langchain-observer start
```

Override the model or endpoint with `OLLAMA_MODEL` / `OLLAMA_BASE_URL`.

## What it shows

- **Demo 1 — plain chat.** `ChatOllama.invoke(...)` → one `chat` span carrying
  real token usage pulled from Ollama's `usage_metadata`.
- **Demo 2 — ReAct agent.** A LangGraph agent → an `invoke_agent` tree with a
  `chat` span per model turn. LangGraph plumbing (`RunnableSequence`,
  `ChannelWrite`, `Branch`, …) is skipped; their children reparent to the
  nearest kept node, so the tree stays readable.
- **Demo 3 — direct tool call.** Invoking a tool through LangChain →
  `execute_tool` span with arguments and result captured as content. (Small
  local models call tools unreliably, so this proves tool capture deterministically.)

Sample output:

```
=== Demo 1 · ChatOllama.invoke (llama3.2) ===
chat llama3.2 [client]  —  tokens 35→36

=== Demo 2 · LangGraph ReAct agent + multiply tool ===
invoke_agent LangGraph [internal]
  └ invoke_agent agent [internal]
    └ chat llama3.2 [client]  —  tokens 176→24
  └ invoke_agent tools [internal]
  └ invoke_agent agent [internal]
    └ chat llama3.2 [client]  —  tokens 103→42

=== Demo 3 · direct tool call (deterministic capture) ===
execute_tool multiply [internal]  —  args {"a":23,"b":19} · result 437
```

> Cost (`gen_ai.usage.cost.usd`) is omitted here because local Ollama models
> have no entry in `MODEL_PRICING` — they're free. Hosted models get priced
> automatically.

## How content capture works

Prompts, tool arguments, and tool results are **off by default**. This example
opts in with `exportContent: (event) => event`; return a redacted event (or
`undefined`) from that callback to control exactly what reaches a span.
