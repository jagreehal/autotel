# Example Queries for Claude

Once you've configured the OpenTelemetry MCP server in Claude Desktop, you can ask these natural language questions to query your traces.

## Getting Started

### Basic Queries

**List all services:**
> "What services are being traced?"

**Recent traces:**
> "Show me traces from the last 5 minutes"

**Service overview:**
> "Give me an overview of the mcp-observability-demo service"

## Error Analysis

**Find errors:**
> "Show me all traces with errors from the last 10 minutes"

**Specific error types:**
> "Find all traces with payment failures"

**Error patterns:**
> "What are the most common errors in the system?"

**Error details:**
> "Show me the details of the most recent error trace"

## Performance Analysis

### Response Time Queries

**Slowest endpoints:**
> "What are the slowest endpoints?"

**Slow traces:**
> "Show me traces that took longer than 500ms"

**Performance comparison:**
> "Compare the average response times of different endpoints"

### Database Performance

**Slow queries:**
> "Find database queries that took longer than 100ms"

**Query patterns:**
> "Show me all slow database queries and their execution times"

**Database operations:**
> "List all database operations by table name"

**Specific table analysis:**
> "Show me all queries to the 'orders' table"

## Business Logic Analysis

### Payment Operations

**Payment failures:**
> "Find all failed payment transactions"

**Payment status:**
> "Show me the payment.status for all payment transactions"

**Expensive transactions:**
> "Find all payment transactions over $100"

**Payment gateway performance:**
> "What's the average response time for the payment gateway?"

### Order Processing

**Order creation:**
> "Show me traces for order creation in the last hour"

**Failed orders:**
> "Find orders that failed during processing"

**Order pipeline:**
> "Show me the complete trace for a successful order including all nested spans"

**Validation issues:**
> "Find traces where validation failed"

## Custom Attribute Queries

These queries leverage the custom attributes set in the application:

**DB query times:**
> "Find all traces where db.query_time_ms is greater than 150"

**Slow query flag:**
> "Show me all traces where db.slow_query is true"

**Item counts:**
> "Find orders with more than 5 items (order.item_count > 5)"

**User activity:**
> "Show me all activity for user-123"

**Notification failures:**
> "Find traces where notification.sent is false"

## Advanced Queries

### Time-based Analysis

**Peak traffic:**
> "Show me traces grouped by hour to identify peak traffic times"

**Recent activity:**
> "What endpoints have been called in the last 30 minutes?"

**Trend analysis:**
> "Has the error rate increased in the last hour compared to the previous hour?"

### Multi-span Analysis

**Trace depth:**
> "Find traces with more than 5 spans (complex operations)"

**Nested operations:**
> "Show me traces that include both database and payment operations"

**Complete workflows:**
> "Find traces that have spans for validation, payment, database, and notification"

### Comparative Analysis

**Error rates:**
> "Which endpoints have the highest error rate?"

**Performance ranking:**
> "Rank all endpoints by average response time"

**Success vs failure:**
> "Compare successful vs failed order processing traces"

## Debugging Scenarios

### Investigate Specific Issues

**Intermittent failures:**
> "Show me all requests to /api/flaky and their outcomes"

**Timeout investigation:**
> "Find traces where the total duration exceeded 1 second"

**Missing data:**
> "Find traces where db.rows_returned is 0"

### Root Cause Analysis

**Payment failures:**
> "Show me the full trace for a failed payment including all attributes and child spans"

**Slow endpoint investigation:**
> "For the /api/events/report endpoint, show me the span breakdown to identify bottlenecks"

**Error context:**
> "Find the trace with the most recent error and show me all the span attributes leading up to the error"

## Query Tips

### Be Specific

❌ Bad: "Show me some traces"
✅ Good: "Show me traces with errors from the last 10 minutes for the mcp-observability-demo service"

### Use Time Ranges

Always specify a time range for better results:
- "in the last 5 minutes"
- "from the last hour"
- "in the past 30 minutes"

### Filter by Attributes

Use the custom attributes we've added:
- `db.query_time_ms`
- `db.slow_query`
- `payment.status`
- `order.item_count`
- `notification.sent`

### Ask Follow-up Questions

Claude maintains context, so you can drill down:

1. "Show me traces with errors"
2. "What are the common attributes in these error traces?"
3. "Show me the full details of the first error"
4. "What was happening in the database span of that trace?"

## Example Query Flow

Here's a realistic debugging session:

```
You: "Show me traces with errors from the last 10 minutes"
Claude: [Shows 3 error traces]

You: "What do these errors have in common?"
Claude: [Analyzes common attributes]

You: "Show me the full trace for the first error including all nested spans"
Claude: [Displays complete trace tree]

You: "What was the value of payment.status in that trace?"
Claude: [Shows payment.status = 'failed']

You: "Find all traces where payment.status is 'failed' in the last hour"
Claude: [Shows all payment failures]

You: "What's the failure rate for payments?"
Claude: [Calculates percentage based on total payment attempts]
```

## Metrics and Aggregations

**Count queries:**
> "How many traces have errors?"

**Averages:**
> "What's the average response time for the /api/users endpoint?"

**Percentiles:**
> "What's the 95th percentile response time for all endpoints?"

**Distributions:**
> "Show me the distribution of database query times"

## Testing Your Queries

1. **Generate traffic first**: Run `./generate-traffic.sh` or manually make requests
2. **Start with simple queries**: Begin with "Show me recent traces" to verify connectivity
3. **Use specific time ranges**: Helps narrow down results
4. **Ask for clarification**: If results are unclear, ask Claude to explain
5. **Explore attributes**: Ask "What attributes are available on these spans?"

## MCP Server Capabilities

The OpenTelemetry MCP server provides these tools that Claude uses automatically:

- `search_traces` - Search with filters
- `search_spans` - Find specific spans
- `get_trace` - Get complete trace details
- `find_errors` - Locate error traces
- `list_services` - List instrumented services

Claude decides which tool to use based on your question!

---

**Pro Tip:** Save commonly used queries in a document so you can quickly copy-paste them during incidents or debugging sessions.
