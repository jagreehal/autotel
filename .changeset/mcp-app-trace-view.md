---
'autotel-mcp': minor
'autotel-devtools': minor
---

**autotel-mcp**

- `get_trace` comes with an interactive waterfall. Claude, ChatGPT, VS Code and other clients that render MCP Apps draw the trace inline in the chat, and a span you click reaches the model as context. Other clients get the JSON as before.
- Spans carry `span.kind` from the collector, Tempo and devtools backends.

**autotel-devtools**

- `autotel-devtools/mcp-app/trace`: the waterfall as a standalone MCP App view.
