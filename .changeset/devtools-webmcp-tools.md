---
'autotel-devtools': minor
---

The full-page viewer now offers its telemetry to in-page AI agents as WebMCP tools.

An agent driving the browser reads what the panel shows — no CLI, no API key, no screenshots:

| Tool                       | Answers                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `autotel_query_traces`     | Search traces — one row each: name, service, status, duration     |
| `autotel_get_trace`        | Every span of one trace, by id                                    |
| `autotel_list_errors`      | What is failing, grouped by fingerprint                           |
| `autotel_query_logs`       | Search log records, with the trace id when there is one           |
| `autotel_webmcp_inventory` | The page's own WebMCP tool surface, including dropped annotations |

They take the same query language as the UI's query bar. Results are projected to the columns the list views show and capped per call, keeping an agent's context on the rows it asked for.

Read-only, and full-page only: the embedded widget is a guest in someone else's page, where `document.modelContext` belongs to that page — so its bundle carries none of this. Registered against the browser's WebMCP API directly, with no runtime dependency.
