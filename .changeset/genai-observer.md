---
'autotel-genai': minor
---

Add `autotel-genai/observer`: an event-stream adapter that turns a framework's lifecycle events into canonical `gen_ai.*` spans.

`createGenAiObserver()` reconstructs the span tree from flat `*.start`/`*.end` events and prices token usage. It force-closes abandoned child spans, and keeps prompt and tool content off spans unless you pass an `exportContent` callback. Token usage lands on leaf `chat` spans only, so aggregate `agent` and `workflow` spans never double-count `gen_ai.usage.*`.

Two framework adapters ship with it:

- `createLangChainObserver()`: a LangChain/LangGraph callback handler. `runId`/`parentRunId` map onto the span tree, and the adapter skips LangGraph plumbing chains and reparents their children to the nearest kept node.
- `observeAiSdkResult()`: walks a Vercel AI SDK `generateText`/`streamText` result into chat and tool spans.

Both adapters are dependency-free, typed structurally against the framework shapes.
