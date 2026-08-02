---
'autotel-docs': patch
---

Give each local backend its own compose file under `docker/`, and document
running them.

`docker-compose.yml` becomes `docker/jaeger.yml` and `docker-compose.lgtm.yml`
becomes `docker/lgtm.yml`, so adding a third stack means adding a file rather
than editing a shared one. Each pins an explicit `name:`, so the compose project
is identified by the stack rather than by the directory it is run from.

The LGTM file now publishes Tempo on 3200 and Prometheus on 9090 alongside Loki
on 3100. Without them the stack accepted telemetry that no tool could read back:
`autotel-mcp`'s `tempo`, `prometheus` and `loki` backends already default to
exactly those ports, and its `auto` probes (`/api/echo`, `/api/v1/status/buildinfo`,
`/ready`) resolve against them unchanged.

Adds a Local Stacks page covering both stacks, what each is for, and the two
port clashes worth knowing: the stacks cannot run together because both bind
OTLP on 4317/4318, and `autotel-devtools` defaults to 4318 so it needs
`AUTOTEL_DEVTOOLS_PORT=4319` to sit alongside LGTM. The devtools and MCP pages
link across to it.
