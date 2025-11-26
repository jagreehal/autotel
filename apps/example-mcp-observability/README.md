# MCP Observability Example

**AI-Assisted Observability with Autotel and OpenTelemetry MCP Server**

This example demonstrates the complete workflow for using AI to query and analyze your application's OpenTelemetry traces. Instead of manually searching through trace dashboards, you can ask Claude natural language questions about your observability data.

## What You'll Learn

- How to instrument a Node.js application with `autotel`
- How to collect traces in Jaeger locally
- How to configure the OpenTelemetry MCP server
- How to query traces using Claude with natural language

## Architecture

```
┌─────────────────────┐
│  Your Application   │
│  (instrumented with │──┐
│   autotel)      │  │ OTLP/gRPC
└─────────────────────┘  │ (port 4317)
                         ▼
                    ┌─────────┐
                    │ Jaeger  │◄────┐
                    │ Backend │     │
                    └─────────┘     │
                         ▲          │
                         │          │ HTTP API
                    (UI) │          │ (port 16686)
                         │          │
                    ┌─────────────────────────┐
                    │ OpenTelemetry MCP Server│
                    │  (Python, via pipx/uvx) │
                    └─────────────────────────┘
                              ▲
                              │ MCP Protocol
                              │
                    ┌─────────────────┐
                    │ Claude Desktop  │
                    │  (AI Assistant) │
                    └─────────────────┘
```

## Prerequisites

Before you begin, ensure you have:

- **Node.js** (v18 or higher)
- **Docker & Docker Compose** (for running Jaeger)
- **Python** (v3.11 or higher)
- **pipx** or **uv** (for running the MCP server)
- **Claude Desktop** (optional, for AI-assisted querying)

### Installing Prerequisites

**Install pipx (recommended):**
```bash
# macOS
brew install pipx
pipx ensurepath

# Or use uv (faster alternative)
brew install uv
```

**Install Claude Desktop:**
Download from [claude.ai/download](https://claude.ai/download)

## Quick Start

### 1. Start Jaeger Backend

```bash
# From this directory
pnpm docker:up

# Verify Jaeger is running
open http://localhost:16686
```

You should see the Jaeger UI. It will be empty until we generate some traces.

### 2. Install Dependencies & Start the App

```bash
# Install dependencies (from monorepo root)
pnpm install

# Start the demo application
pnpm start
```

The server will start on `http://localhost:3000`. You should see:

```
🚀 MCP Observability Demo Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Server running at: http://localhost:3000
📈 Jaeger UI: http://localhost:16686
...
```

### 3. Generate Some Traces

Make requests to create interesting trace patterns:

```bash
# Fast endpoint
curl http://localhost:3000/api/users

# Variable speed (sometimes slow)
curl http://localhost:3000/api/users/user-123/orders

# Complex nested trace with multiple spans
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-123","items":[{"id":"item-1"}],"total":99.99}'

# Slow endpoint (always > 500ms)
curl http://localhost:3000/api/events/report

# Error endpoint
curl http://localhost:3000/api/error

# Random success/failure
curl http://localhost:3000/api/flaky
```

**Or use the provided script:**

```bash
# Generate diverse traffic patterns
./generate-traffic.sh
```

### 4. View Traces in Jaeger

Open http://localhost:16686 and:

1. Select service: `mcp-observability-demo`
2. Click "Find Traces"
3. Explore the traces to see:
   - Request spans with HTTP metadata
   - Nested database query spans
   - Payment processing spans
   - Error traces with exception details
   - Custom attributes on each span

### 5. Configure OpenTelemetry MCP Server

The MCP server allows AI assistants to query your traces.

**Option A: Use with Claude Desktop**

1. Find your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Add the MCP server configuration:

```json
{
  "mcpServers": {
    "opentelemetry": {
      "command": "uvx",
      "args": [
        "opentelemetry-mcp",
        "--backend",
        "jaeger",
        "--url",
        "http://localhost:16686"
      ],
      "env": {
        "LOG_LEVEL": "INFO",
        "MAX_TRACES_PER_QUERY": "100"
      }
    }
  }
}
```

3. Restart Claude Desktop

4. Verify the server is connected:
   - Look for the 🔌 icon in Claude Desktop
   - Click it to see "opentelemetry" listed

**Option B: Run MCP Server Standalone (for testing)**

```bash
# Run without installation
uvx opentelemetry-mcp --backend jaeger --url http://localhost:16686

# Or with pipx
pipx run opentelemetry-mcp --backend jaeger --url http://localhost:16686
```

### 6. Query Traces with AI

Once configured, you can ask Claude questions about your traces:

**Example Queries:**

- *"Show me all traces with errors from the last 10 minutes"*
- *"What are the slowest endpoints in my service?"*
- *"Find traces where database queries took longer than 100ms"*
- *"List all failed payment transactions"*
- *"Which endpoints have the highest error rate?"*
- *"Show me the trace for the slowest request"*
- *"Find all slow database queries and show their query times"*

Claude will use the MCP server to query Jaeger and provide insights!

## Available Endpoints

The demo app provides several endpoints with different trace patterns:

| Endpoint | Method | Description | Trace Pattern |
|----------|--------|-------------|---------------|
| `/health` | GET | Health check | Fast, no custom spans |
| `/api/users` | GET | List users | Fast, single DB span |
| `/api/users/:id/orders` | GET | User orders | Variable speed, sometimes slow |
| `/api/orders` | POST | Create order | Complex nested spans (validation → payment → DB → notification) |
| `/api/events/report` | GET | Generate report | Always slow (> 500ms) |
| `/api/error` | GET | Test errors | Intentional error with stack trace |
| `/api/flaky` | GET | Random behavior | 50% chance of failure |

## Understanding the Traces

### Trace Attributes

The application adds custom attributes to help with querying:

**Database Operations:**
- `db.system` - Database type (e.g., "postgresql")
- `db.operation` - SQL operation (SELECT, INSERT, etc.)
- `db.table` - Table name
- `db.query_time_ms` - Query execution time
- `db.slow_query` - Boolean flag for slow queries
- `db.rows_returned` - Number of rows

**Payment Operations:**
- `payment.gateway` - Payment processor (e.g., "stripe")
- `payment.amount` - Transaction amount
- `payment.status` - success/failed
- `payment.transaction_id` - Unique transaction ID
- `payment.error` - Error reason if failed

**Order Operations:**
- `order.user_id` - User identifier
- `order.item_count` - Number of items
- `order.total` - Order total amount
- `order.status` - Order status

These attributes make it easy to filter traces. For example, you can ask Claude:
*"Find all orders where payment.status is 'failed'"*

## MCP Server Tools

The OpenTelemetry MCP server provides 9 tools that Claude can use:

1. **search_traces** - Query traces with filters
2. **search_spans** - Find specific spans
3. **get_trace** - Retrieve complete trace details
4. **get_llm_usage** - Aggregate token usage (for LLM traces)
5. **list_services** - Show instrumented services
6. **find_errors** - Locate error traces
7. **list_llm_models** - Identify LLM models in use
8. **get_llm_model_stats** - Compare model performance
9. **get_llm_expensive_traces** - Find high-token requests

## Troubleshooting

### Jaeger isn't showing traces

1. Verify Jaeger is running:
   ```bash
   docker ps | grep jaeger
   ```

2. Check the OTLP endpoint:
   ```bash
   curl http://localhost:4318/v1/traces
   ```

3. Verify app is sending traces (check app logs for errors)

### MCP server not connecting

1. Check Claude Desktop config file location
2. Verify JSON syntax is valid
3. Restart Claude Desktop after changes
4. Check Claude Desktop logs:
   - macOS: `~/Library/Logs/Claude/`

### No traces appearing in queries

1. Generate traffic first (traces won't exist until requests are made)
2. Check time range in your query
3. Verify service name matches: `mcp-observability-demo`

## Advanced Configuration

### Using Different Backends

The MCP server supports multiple backends:

**Grafana Tempo:**
```json
{
  "command": "uvx",
  "args": [
    "opentelemetry-mcp",
    "--backend",
    "tempo",
    "--url",
    "http://localhost:3200"
  ]
}
```

**Traceloop Cloud:**
```json
{
  "command": "uvx",
  "args": [
    "opentelemetry-mcp",
    "--backend",
    "traceloop",
    "--api-key",
    "YOUR_API_KEY"
  ]
}
```

### Environment Variables

Create a `.env` file (copy from `.env.example`):

```bash
# OpenTelemetry endpoint
OTLP_ENDPOINT=http://localhost:4318

# Server port
PORT=3000
```

## Next Steps

- **Add LLM Instrumentation**: Integrate with `@traceloop/node-server-sdk` for LLM-specific traces
- **Custom Attributes**: Add your own business-specific attributes to traces
- **Production Setup**: Configure for production backends (Tempo, Honeycomb, Datadog, etc.)
- **Alerts**: Use MCP server to build AI-powered alerting workflows

## Resources

- [Autotel Documentation](../../packages/autotel/README.md)
- [OpenTelemetry MCP Server](https://github.com/traceloop/opentelemetry-mcp-server)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)

## License

MIT
