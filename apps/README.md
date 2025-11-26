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
     logger: createLogger('my-app', { level: 'debug' })
   });
   ```

### Environment variables not loading

Make sure `.env` file exists in the app directory:
```bash
cd apps/example-basic
cp .env.example .env
# Edit .env with your OTLP_ENDPOINT
```

