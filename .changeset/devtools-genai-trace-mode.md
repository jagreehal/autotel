---
'autotel-devtools': minor
---

GenAI view: a "Trace" mode that decomposes a run into a depth-indented tree.

Alongside List and Timeline, the GenAI tab now has a **Trace** view that breaks the selected run down into what actually happened inside it — each model call decomposed into its reasoning, the tools it called and the text it wrote, with nested sub-agents underneath. Built from the real span tree (`parentSpanId` + GenAI semantics), so it adapts to both common shapes:

- **Pydantic AI + Logfire** — `invoke_agent → [chat, execute_tool, chat]`: the tool is its own span, shown with its result; the chats are leaf steps and the answer step carries the text.
- **Wrapper-span runs** — an outer generate span (e.g. `ai.generateText`) that is itself classified as a `chat` renders as a container `group`, its child model calls as steps, and the inline tool call is synthesized under the step that made it.

Tool calls are deduped two ways so they appear exactly once: against a dedicated `execute_tool` span, and against the same call id replayed across later steps' input history. Clicking any node jumps to that span in the List view.

New pure, unit-tested helpers exported from the widget internals: `buildRunTrace` and `flattenTrace` (`genai/trace`).
