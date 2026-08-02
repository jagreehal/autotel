# Local observability stacks

Compose files for running a backend on your machine while you develop. One file
per stack, so adding another does not mean editing a shared one.

| Stack                      | Signals               | Start                                       | UI                       |
| -------------------------- | --------------------- | ------------------------------------------- | ------------------------ |
| [`jaeger.yml`](jaeger.yml) | Traces                | `docker compose -f docker/jaeger.yml up -d` | <http://localhost:16686> |
| [`lgtm.yml`](lgtm.yml)     | Traces, metrics, logs | `docker compose -f docker/lgtm.yml up -d`   | <http://localhost:3000>  |

Stop either with `down -v` in place of `up -d`.

Each file pins an explicit compose project name, so the stack is identified by
what it is rather than by the directory the file sits in.

> **They cannot both run.** Both bind OTLP on 4317 and 4318. Bring one down
> before starting the other.

Pick Jaeger when you only care about traces and want the smallest thing that
works. Pick LGTM when you want metrics or logs too, or when you want to query
from `autotel-mcp`.

## Jaeger

```bash
docker compose -f docker/jaeger.yml up -d
```

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Traces appear at <http://localhost:16686>.

## LGTM

Grafana's all-in-one image: **L**oki, **G**rafana, **T**empo and Mimir in one
container. Anonymous admin is enabled, so there is no password to look up.

```bash
docker compose -f docker/lgtm.yml up -d
```

| Port   | Service    | Used for                             |
| ------ | ---------- | ------------------------------------ |
| `3000` | Grafana    | The UI                               |
| `3100` | Loki       | Log push + query (`LOKI_BASE_URL`)   |
| `3200` | Tempo      | Trace query (`TEMPO_BASE_URL`)       |
| `9090` | Prometheus | Metric query (`PROMETHEUS_BASE_URL`) |
| `4317` | OTLP gRPC  | Ingest                               |
| `4318` | OTLP HTTP  | Ingest                               |

The three query ports exist so `autotel-mcp` can read back what you sent. An
ingest-only setup would let you write telemetry you cannot then investigate.

### Send traces and metrics

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### Send events to Loki

```bash
LOKI_ENDPOINT=http://localhost:3100
```

```typescript
import { init } from 'autotel';
import { LokiSubscriber } from 'autotel-subscribers/loki';

init({
  service: 'checkout-api',
  eventSubscribers: [new LokiSubscriber()],
});
```

Query them in Grafana with `{service="checkout-api"} | json`.

### Investigate with autotel-mcp

Point the MCP server at the query ports and let it detect what is up:

```bash
AUTOTEL_BACKEND=auto \
TEMPO_BASE_URL=http://localhost:3200 \
PROMETHEUS_BASE_URL=http://localhost:9090 \
LOKI_BASE_URL=http://localhost:3100 \
npx autotel-mcp
```

Autodetection probes `/api/echo` on Tempo, `/api/v1/status/buildinfo` on
Prometheus and `/ready` on Loki, and uses whatever answers.

### Use alongside autotel-devtools

`autotel-devtools` listens on **4318 by default**, which is the port LGTM binds
for OTLP HTTP. Running both means moving devtools:

```bash
AUTOTEL_DEVTOOLS_PORT=4319 npx autotel-devtools
```

Then send to whichever you want to read from — devtools at
`http://127.0.0.1:4319` for a live local view, LGTM at `http://localhost:4318`
for history and querying.

## Adding a stack

Add `docker/<name>.yml` with:

- a `name:` matching the stack, so the project is stable wherever it is run from
- a `container_name`, so `docker logs` is predictable
- a `healthcheck` gating on the component that comes up **last**, not on the UI
- a comment naming any port that clashes with an existing stack

Then add a row to the table at the top of this file.
