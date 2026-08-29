# Autotel Examples

Simple working examples demonstrating autotel functionality.

## Prerequisites

1. Node.js 22+ installed
2. Grafana Cloud account (or local OTLP collector)
3. Environment variables configured

## Setup

1. **Build the library:**

   ```bash
   # From repo root
   pnpm install
   pnpm build
   ```

2. **Configure OTLP endpoint:**
   Create a `.env` file in each example directory with your Grafana Cloud OTLP endpoint:

   ```bash
   cd apps/example-basic
   # Create .env file
   echo "OTLP_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp" > .env
   ```

   Or use a local OTLP collector:

   ```bash
   echo "OTLP_ENDPOINT=http://localhost:4318" > .env
   ```

## Examples

### Three Pillars vs Unified

**`example-pillars-vs-unified`** - Same failed checkout, two telemetry shapes. Pillars mode prints a siloed metric slice, scattered logs, and a bare span. Unified mode emits one Autotel wide event with `user`, `cart`, `payment.provider`, and `error` together. Built for newcomers; no Docker or API keys.

```bash
cd apps/example-pillars-vs-unified
pnpm start:pillars   # three cabinets; question unanswerable
pnpm start:unified   # one dossier; payment.provider is obvious
```

**See:** [example-pillars-vs-unified/README.md](./example-pillars-vs-unified/README.md).

### Canonical Log Lines Demo

**`example-canonical-logs`** - Demonstrates canonical log lines (wide events) vs traditional logging. Shows how one comprehensive log line per request with all context enables powerful queries instead of string search.

```bash
cd apps/example-canonical-logs
pnpm install
pnpm start:regular   # Traditional logging (multiple log lines)
pnpm start:canonical # Canonical log lines (one wide event per request)
```

**What it does:**

- Shows the difference between regular logging and canonical log lines
- Demonstrates wide events with high-cardinality, high-dimensionality data
- Shows how canonical log lines enable structured queries instead of string search
- Real checkout flow example with user context, cart data, payment info

**See:** [example-canonical-logs/README.md](./example-canonical-logs/README.md) for detailed documentation.

### Experiment, Compare, Keep

**`example-experiment`** - The probe-sense-respond loop end to end: `experiment()` names the guess, one wide event carries the dimensions, `compareCohorts()` finds what separates the slow requests, and `forceKeep()` holds a trace the sampler would drop. The cause of the slowdown is planted, and both scripts assert that autotel finds it.

```bash
cd apps/example-experiment
pnpm start        # 800 checkouts across two arms, then rank the differences
pnpm start:keep   # production sampling on: every decline still kept
```

**See:** [example-experiment/README.md](./example-experiment/README.md).

### Agent Trace as the Audit Trail

**`example-agent-trace`** runs the test an agent trace has to pass: hand a reviewer only the telemetry and ask them to reconstruct why the agent did what it did. A support agent drafts, fails a check, retries with the complaint as context, and issues a refund; `src/reviewer.ts` then answers eight questions from the spans and events alone. The same work as one span and four log lines answers none of them, and both results are asserted.

```bash
cd apps/example-agent-trace
pnpm start
```

### Agent Gates

**`example-agent-gates`** shows the two refusals an agent system needs. `createGenAiGuard` stops a spin-looping agent before it reaches the tool that moves money, and a human approval gate records its outcome and its evidence. Between runs, a candidate procedure must clear the released version's eval score before it ships, and the refusal names the cases that broke.

```bash
cd apps/example-agent-gates
pnpm start             # the gate inside the run
pnpm start:evolution   # the gate between runs
```

### Instrumentation Coverage

**`example-hono`** also answers the question a telemetry backend cannot: which entry points have emitted nothing. `autotel map` scores every route and writes a committed `autotel.map.json`; the coverage check joins that map against what arrived and asserts the result.

```bash
cd apps/example-hono
pnpm map        # score every entry point
pnpm map:check  # fail a build on a regression
pnpm coverage   # call two of five routes, assert the rest report dark
```

### Browser/Web Examples

#### Vanilla JavaScript Example

Ultra-lightweight browser example showing distributed tracing from browser → backend:

```bash
cd apps/example-web-vanilla

# Build autotel-web first
cd ../../packages/autotel-web
pnpm build
cd ../../apps/example-web-vanilla

# Serve with any static server
python3 -m http.server 8000
# Or: npx http-server -p 8000
```

Then open http://localhost:8000 and check DevTools Network tab for `traceparent` headers!

**What it does:**

- Demonstrates `init()` for browser SDK
- Shows automatic `traceparent` header injection on fetch/XHR
- Displays trace IDs in the browser
- Only **1.6KB gzipped** - no OpenTelemetry dependencies!

**See:** [example-web-vanilla/README.md](./example-web-vanilla/README.md) for detailed instructions.

### Node.js Examples

#### Basic Example

Demonstrates basic tracing, metrics, and events:

```bash
cd apps/example-basic
pnpm install
pnpm start
```

**What it does:**

- Creates traced functions with `trace()`
- Tracks business metrics
- Sends events events
- Shows nested traces
- Demonstrates error tracking

### Grafana Example (dashboards and alarms as code)

**`example-grafana`**: A carrier gateway that sends traces (Tempo), metrics (Mimir) and logs (Loki), plus a `grafana/` folder in the repo that owns the dashboard, the alert rule, its threshold, the routing and the runbook. One carrier's auth breaks partway through the run so you can watch the alarm fire against a local stack before it ever reaches production.

```bash
cd apps/example-grafana
pnpm install
docker compose -f grafana/lgtm.overlay.yml up -d   # local stack + this repo's dashboards
pnpm start                                          # http://localhost:3000
```

Point it at Grafana Cloud instead with `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` from the Cloud Portal (Connections → OpenTelemetry → Configure).

**See:** [example-grafana/README.md](./example-grafana/README.md) for credentials, and [example-grafana/grafana/README.md](./example-grafana/grafana/README.md) for the ownership model and how to apply the folder to a real stack.

### HTTP Server Example

Runs an Express server with automatic HTTP instrumentation:

```bash
cd apps/example-http
pnpm install
pnpm start
```

Then visit:

- `http://localhost:3000/health` - Health check
- `http://localhost:3000/users/user-123` - Fetch user
- `http://localhost:3000/users/user-123/orders` - Fetch orders
- `http://localhost:3000/error` - Error example

**What it does:**

- Automatic HTTP request tracing
- Manual database query tracing
- Error tracking
- Nested spans

### Terminal Dashboard Example

Interactive terminal dashboard for viewing traces in real-time:

```bash
cd apps/example-terminal
pnpm install
pnpm start
```

**What it does:**

- Real-time span streaming to terminal dashboard
- Interactive navigation with keyboard controls
- Error filtering and live statistics
- Demonstrates nested spans and error tracking

**Controls:**

- ↑/↓: Navigate spans
- `p`: Pause/resume
- `e`: Toggle error-only filter
- `c`: Clear spans
- Ctrl+C: Exit

**See:** [example-terminal/README.md](./example-terminal/README.md) for detailed instructions.

### Collector Pipeline Example

Puts an OpenTelemetry Collector between the app and the backend, and shows what
belongs there rather than in the SDK:

```bash
cd apps/example-collector-pipeline
docker compose up -d   # collector + otel-tui viewer
pnpm install
pnpm start
docker compose logs otelcol | tail -20
```

**What it does:**

- Masks `user.email` and a card number the app leaked into span attributes
- Drops `/healthz` traces before they cost anything
- Counts requests and exceptions before sampling, so the numbers stay exact
- Keeps every failed trace and 25% of the rest with tail sampling
- Explains why sampling in the SDK and the collector at once multiplies

**See:** [example-collector-pipeline/README.md](./example-collector-pipeline/README.md) for the annotated config.

### GenAI Metrics Example

Derives the canonical GenAI metrics from `gen_ai.*` spans, so cost and latency
dashboards need no metric instruments in application code:

```bash
cd apps/example-genai-metrics
docker compose up -d   # collector + Grafana LGTM
pnpm install
pnpm start
open http://localhost:3000   # import packages/autotel-mcp/src/resources/dashboards/grafana-llm.json
```

**What it does:**

- Emits `gen_ai.*` spans with token usage, estimated cost and streaming timings
- Derives duration, token usage, cost, time to first chunk and tool calls in the collector
- Splits `gen_ai.client.token.usage` by `gen_ai.token.type`, matching the spec
- Converts delta to cumulative, without which Prometheus rejects every write

**See:** [example-genai-metrics/README.md](./example-genai-metrics/README.md) for the annotated connector config.

### GenAI Evaluations Example

Scores agent answers and turns pass rate into something you can alert on:

```bash
cd apps/example-genai-evals
docker compose up -d          # Grafana LGTM
pnpm install
EVAL_SAMPLE_RATE=1 pnpm start
```

**What it does:**

- Runs brevity, groundedness and prompt-injection evaluators, none of which needs a model
- Emits each verdict as a `gen_ai.evaluation.result` event on the conversation's trace
- Samples after the answer exists, so the sample is not biased towards the cheap path
- Gives a pass-rate LogQL query ready for a Grafana alert rule

**See:** [example-genai-evals/README.md](./example-genai-evals/README.md) for the evaluator design.

### AI/LLM Workflow Examples

Demonstrates instrumentation patterns for AI/LLM applications:

```bash
cd apps/example-ai-agent
pnpm install
pnpm start:multi-agent  # Multi-agent workflow
pnpm start:rag          # RAG pipeline
```

**What it does:**

- Multi-agent orchestration (Triage → Specialist → QA)
- RAG pipeline (Embeddings → Search → Generate)
- Correlation ID propagation across agents
- Agent handoff tracking
- Business event instrumentation

**Note:** Uses simulated LLM calls for demonstration. See [example README](./example-ai-agent/README.md) for integration with real LLM SDKs and OpenLLMetry.

**Documentation:** See [docs/AI_WORKFLOWS.md](../docs/AI_WORKFLOWS.md) for comprehensive AI workflow patterns.

#### Vercel AI SDK as canonical `gen_ai.*` spans

**`example-ai-sdk-observer`** - Capture Vercel AI SDK + Ollama runs as canonical `gen_ai.*` spans (token usage, cost, streaming timing) via `autotel-genai`'s `autotelTelemetry()`. See [example-ai-sdk-observer/README.md](./example-ai-sdk-observer/README.md).

#### Langfuse + autotel-devtools

**`example-langfuse`** - Instrument once with `autotel-genai` and fan the same canonical `gen_ai.*` spans to [Langfuse](https://langfuse.com), [autotel-devtools](../packages/autotel-devtools), and your console. Using autotel's native OTLP `destinations`, with **no `@langfuse/otel` and no `@opentelemetry/*` exporter packages**. Langfuse is a destination, not a span source; the semconv is the integration. See [example-langfuse/README.md](./example-langfuse/README.md).

#### PostHog session join

**`example-posthog`** - `joinPostHog` on a checkout that fails. The browser span carries a replay URL, the PostHog event carries `$trace_id`, and the server span carries `session.id` from W3C baggage. See [example-posthog/README.md](./example-posthog/README.md).

## Verifying in Grafana

1. **Open Grafana Cloud** (or your Grafana instance)
2. **Navigate to Explore**
3. **Select your data source** (OTLP/Tempo)
4. **Query traces**:
   - Service: `example-service` or `example-http-server`
   - Look for spans with names like `createUser`, `processPayment`, `createOrder`

## Troubleshooting

### No traces appearing in Grafana

1. **Check OTLP endpoint:**

   ```bash
   echo $OTLP_ENDPOINT
   ```

   Should match your Grafana Cloud endpoint.

2. **Check network connectivity:**

   ```bash
   curl -v $OTLP_ENDPOINT/v1/traces
   ```

3. **Enable debug logging:**
   ```typescript
   import { createLogger } from 'autotel/logger';

   init({
     service: 'my-app',
     logger: createLogger('my-app', { level: 'debug' }),
   });
   ```

### Environment variables not loading

Make sure `.env` file exists in the app directory:

```bash
cd apps/example-basic
cp .env.example .env
# Edit .env with your OTLP_ENDPOINT
```
