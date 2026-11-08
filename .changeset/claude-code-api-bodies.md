---
'autotel-agents': minor
'autotel-devtools': minor
---

Claude Code's raw API bodies, read into each call.

- **autotel-agents**: `api_request_body` and `api_response_body` (`OTEL_LOG_RAW_API_BODIES=1`) fold onto the `api_request` of the same call, in any arrival order, joined by `request_body_id` or, on Claude Code versions without it, by model and time: `stopReason`, `thinkingTokens`, cache writes by lifetime (`cacheWrite1hTokens`, `cacheWrite5mTokens`), `toolUses`, `serviceTier`, `requestBytes`, and `request` (system prompt characters, tool definitions, messages) for bodies under Claude Code's 60 KB limit. The rollup totals `stopReasons`, `thinkingTokens`, both cache lifetimes and `largestRequestBytes`. The package is marked side-effect free, so a bundle importing `summarizeSessions` alone leaves the adapters out.
- **autotel-devtools**: `claude --log-api-bodies` and `agents enable --log-api-bodies` export the bodies, and the Agents tab shows stop reasons, thinking tokens, cache lifetimes and the largest request. The embedded widget is 5 KB smaller.
