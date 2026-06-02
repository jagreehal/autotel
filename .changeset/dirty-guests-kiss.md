---
'autotel-mcp': patch
---

Keep signal tools enabled when the startup probe can't reach the backend. The runtime signal probe runs once at MCP startup; if `searchTraces`/`listMetrics`/`searchLogs` threw — because an HTTP backend (Jaeger, Tempo, autotel-devtools) was momentarily down or still starting when the server connected — the catch marked the signal `unsupported`, gating its tools off for the entire session even after the backend recovered.

Capabilities already declare which signals a backend supports, so a transient probe failure no longer overrides that. A new `unconfirmed` state (`enabled: true`, `hasData: false`) is returned from the probe's catch branches, so trace/metric/log tools stay registered and live queries retry on demand. Only an explicit `unsupported` result from the backend (or a capability that isn't `available`) disables a signal.
