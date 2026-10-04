/**
 * Calls the running app (`pnpm dev` or `pnpm start`) through an instrumented
 * MCP client, so each server span is a child of a client span in one trace.
 *
 *   pnpm call                      # http://localhost:3000/mcp
 *   MCP_URL=http://host/mcp pnpm call
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { init, otelTrace, shutdown } from 'autotel';
import { instrumentMcpClient } from 'autotel-mcp-instrumentation';

init({
  service: 'example-skybridge-client',
  debug: 'pretty',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const url = new URL(process.env.MCP_URL ?? 'http://localhost:3000/mcp');
const client = instrumentMcpClient(
  new Client({ name: 'example-skybridge-client', version: '0.0.0' }),
);
await client.connect(new StreamableHTTPClientTransport(url));

await otelTrace
  .getTracer('example-skybridge-client')
  .startActiveSpan('plan trip', async (span) => {
    const search = await client.callTool({
      name: 'search-flights',
      arguments: { from: 'LHR', to: 'JFK' },
    });
    console.log('search-flights →', search.structuredContent);

    const booking = await client.callTool({
      name: 'book-flight',
      arguments: { id: 'XX999' },
    });
    console.log('book-flight → isError:', booking.isError);

    console.log('trace id:', span.spanContext().traceId);
    span.end();
  });

await client.close();
await shutdown();
