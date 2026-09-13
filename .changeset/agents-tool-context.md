---
'autotel-agents': minor
'autotel-devtools': patch
'autotel-claude-code': patch
---

`autotel-agents`: `ToolUsage.contextTokens` attributes context growth to the tool that caused it — the prompt growth between the request that called the tool and the one that consumed its result, split across parallel results by `tool_result_size_bytes` when reported and evenly otherwise. Sub-agent results are charged against the sub-agent's own requests. The devtools Agents tab shows it next to each tool.

`autotel-claude-code`: `claude_code.decided_by` follows the final denial down through forwarding links to the plugin that decided it; skipped hooks are ignored.

Devtools: a trace's `partial` flag clears in the live tail once its root span arrives in a later batch.
