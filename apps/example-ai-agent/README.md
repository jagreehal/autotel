# AI/LLM Workflow Examples

Demonstrates instrumentation patterns for AI/LLM applications using Autotel.

## Examples Included

### 1. Multi-Agent Workflow - Simulated (`src/multi-agent-workflow.ts`)

**Best for:** Learning instrumentation patterns without needing API keys

Demonstrates a three-agent escalation system using **simulated LLM calls**:
- **Triage Agent**: Analyzes requests and creates plans
- **Specialist Agent**: Executes detailed analysis
- **QA Agent**: Reviews and validates output

**Key Patterns:**
- Multi-step workflow orchestration
- Correlation ID propagation across agents
- Agent handoff tracking
- Business event instrumentation
- Conditional workflow paths

**Run:**
```bash
pnpm start:multi-agent
```

**Note:** This example uses simulated LLM responses. No API key required.

### 2. Multi-Agent Workflow - Real LLMs (`src/multi-agent-workflow-with-openllmetry.ts`)

**Best for:** Production patterns with real LLM instrumentation

The **recommended approach** showing OpenLLMetry + autotel + @openai/agents integration:
- **@openai/agents**: Official OpenAI framework for multi-agent orchestration and handoffs
- **OpenLLMetry**: Automatic instrumentation of OpenAI SDK calls (prompts, tokens, completions)
- **autotel trace()**: Manual instrumentation for workflow orchestration and business metrics
- **Perfect integration**: All three layers appear in the same trace with shared correlation IDs

**Prerequisites:**
```bash
# Required: Ollama running locally with gpt-oss:20b model
ollama pull gpt-oss:20b
ollama serve

# Optional: OTLP endpoint (defaults to http://localhost:4318)
export OTLP_ENDPOINT=http://localhost:4318
```

**Note:** This example uses Ollama's OpenAI-compatible API endpoint (`http://localhost:11434/v1`), which allows:
- @openai/agents framework to work with local models (requires `setOpenAIAPI('chat_completions')`)
- OpenLLMetry to automatically instrument the LLM calls as if they were OpenAI API calls

**Important:** Ollama only supports the Chat Completions API, not the Responses API. The example configures this with `setOpenAIAPI('chat_completions')`.

**Run:**
```bash
pnpm start:multi-agent-openllmetry
```

**What you'll observe:**
- **4 spans total** (all share the same traceId):
  - `workflow.multi_agent_escalation` - Root span from autotel `trace()`
  - `openai.chat` (×2) - LLM call spans auto-created by OpenLLMetry (one per agent)
  - `@traceloop/instrumentation-openai` - OpenLLMetry instrumentation layer
- Business metrics alongside technical LLM metrics
- Complete correlation across all spans via correlation IDs
- Console output shows spans when using `ConsoleSpanExporter` (default in example)

**Key Differences from Simulated Version:**
| Aspect | Simulated | Real (OpenLLMetry) |
|--------|-----------|-------------------|
| **LLM Calls** | `simulateLLMCall()` | OpenAI SDK via @openai/agents |
| **Setup** | Not required | Ollama + gpt-oss:20b model |
| **Agent Framework** | Manual implementation | @openai/agents v0.3.2 |
| **LLM Instrumentation** | Manual attributes only | Automatic via OpenLLMetry |
| **Prompts/Completions** | Not captured | Fully captured by OpenLLMetry |
| **Token Usage** | Simulated | Real token counts from model |
| **Cost** | Free | Free (runs locally) |
| **Use Case** | Learning, testing | Production patterns |

### 3. RAG Pipeline (`src/rag-pipeline.ts`)

Demonstrates a complete Retrieval-Augmented Generation pipeline:
- **Embeddings**: Query vectorization
- **Search**: Vector database retrieval
- **Context Assembly**: Combining retrieved chunks
- **Generation**: LLM response with context

**Key Patterns:**
- Pipeline stage tracking
- Vector search observability
- Context assembly metrics
- Token usage tracking
- Source attribution

**Run:**
```bash
pnpm start:rag
```

## Getting Started

### Prerequisites

From the monorepo root:

```bash
# Install dependencies
pnpm install

# Build packages
pnpm build
```

### Running Examples

```bash
# Navigate to this example
cd apps/example-ai-agent

# Run multi-agent workflow (simulated LLMs - no API key needed)
pnpm start:multi-agent

# Run multi-agent workflow with real LLMs (requires Ollama with gpt-oss:20b)
pnpm start:multi-agent-openllmetry

# Run RAG pipeline
pnpm start:rag
```

### Configuration

Set these environment variables (optional):

```bash
# OTLP endpoint (defaults to http://localhost:4318)
export OTLP_ENDPOINT=http://localhost:4318

# Node environment
export NODE_ENV=development

# Debug mode - see spans in console
export AUTOTEL_DEBUG=true  # Enables console output
```

### Quick Debug Mode

See traces instantly - perfect for progressive development:

```typescript
import { init } from 'autotel';

// Console-only mode (no backend needed)
init({
  service: 'my-app',
  debug: true  // Outputs spans to console
});

// Later: add endpoint for console + backend
init({
  service: 'my-app',
  debug: true,
  endpoint: 'https://otlp.datadoghq.com'  // Now sends to both
});
```

**How it works:**
- `debug: true` - Print spans to console AND send to backend (if endpoint configured)
  - No endpoint = console-only (perfect for local development)
  - With endpoint = console + backend (verify before choosing provider)
- No debug flag - Send to backend only (default)

This is especially useful for:
- Testing AI workflows locally without Grafana/Datadog/etc.
- Debugging LLM instrumentation to see what OpenLLMetry captures
- Verifying traces before deploying to production

## Understanding the Output

Each example shows:
1. **Console output**: Human-readable workflow progress
2. **Telemetry**: Sent to OTLP endpoint (view in your observability backend)
3. **Correlation IDs**: Track requests across all operations

### Correlation IDs

Every workflow generates a correlation ID automatically:
```
Correlation ID: 1a2b3c4d5e6f7g8h
```

Use this ID to:
- Filter traces in your observability backend
- Track workflows across multiple services
- Debug issues in production

## OpenLLMetry Integration

This repo includes **two versions** of the multi-agent workflow to demonstrate different approaches:

### Simulated Version (`multi-agent-workflow.ts`)

- **Purpose:** Learn instrumentation patterns without API keys
- **LLM Calls:** Simulated with delays
- **Cost:** Free
- **When to use:** Testing, learning, CI/CD pipelines

### Real LLM Version (`multi-agent-workflow-with-openllmetry.ts`)

- **Purpose:** Production-ready pattern with automatic LLM instrumentation
- **Agent Framework:** @openai/agents v0.3.2 for multi-agent orchestration
- **LLM Calls:** Real LLM calls via OpenAI SDK + Ollama (gpt-oss:20b model)
- **OpenLLMetry:** Built-in initialization - automatically captures prompts, completions, tokens
- **Cost:** Free (runs locally with Ollama)
- **When to use:** Production applications, understanding full observability

**Key Insight:** See `multi-agent-workflow-with-openllmetry.ts` for the **recommended production pattern** that combines:
1. **@openai/agents** for agent orchestration and handoffs
2. **OpenLLMetry** for automatic LLM instrumentation (enabled via `init()`)
3. **autotel trace()** for workflow orchestration (business context)

**Initialization Pattern:**
```typescript
// Everything configured in one place - the recommended approach
init({
  service: 'my-app',
  spanExporter: consoleExporter,

  // Enable OpenLLMetry for automatic LLM instrumentation
  openllmetry: {
    enabled: true,
    options: {
      disableBatch: true,
      instrumentModules: { openAI: OpenAI },
    },
  },
});
```

All three layers integrate seamlessly, creating a complete observability stack!

## Observability Backends

View telemetry in any OTLP-compatible backend:

### Local Development (Grafana Stack)

```bash
# Start Grafana + Tempo + Prometheus (from root)
docker-compose up -d

# Set endpoint
export OTLP_ENDPOINT=http://localhost:4318
```

View traces at: http://localhost:3000

### Cloud Providers

```bash
# Grafana Cloud
export OTLP_ENDPOINT=https://otlp-gateway-prod.grafana.net/otlp

# Datadog
export OTLP_ENDPOINT=https://otlp.datadoghq.com

# Honeycomb
export OTLP_ENDPOINT=https://api.honeycomb.io/v1/traces
```

## Key Instrumentation Patterns

### 1. Nested Spans (Parent-Child Hierarchies)

```typescript
export const workflow = trace('workflow', ctx => async () => {
  // This creates a parent span
  const step1 = await trace('step1', async () => {
    // Child span
    return result;
  });
});
```

### 2. Correlation IDs

```typescript
export const workflow = trace('workflow', ctx => async () => {
  // Auto-available!
  console.log(ctx.correlationId);

  // Automatically propagates to nested operations
  await childOperation(); // Inherits correlation context
});
```

### 3. Business Events

```typescript
ctx.addEvent('agent_handoff', {
  from: 'triage',
  to: 'specialist',
});

track('workflow_completed', {
  duration_ms: 1234,
  success: true,
});
```

### 4. Domain Attributes

```typescript
ctx.setAttributes({
  'agent.role': 'specialist',
  'agent.model': 'gpt-4o',
  'workflow.type': 'multi_agent',
});
```

## Learn More

- **Documentation**: See [docs/AI_WORKFLOWS.md](../../docs/AI_WORKFLOWS.md) for comprehensive patterns
- **Autotel Core**: See [packages/autotel/README.md](../../packages/autotel/README.md)
- **OpenLLMetry**: https://github.com/traceloop/openllmetry

## Next Steps

1. ✅ Run the examples to see instrumentation in action
2. ✅ View traces in your observability backend
3. ✅ Adapt patterns for your AI workflows
4. ✅ Enable OpenLLMetry for automatic LLM instrumentation
5. ✅ Add custom business events and attributes
