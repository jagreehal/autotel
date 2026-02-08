#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { instrumentMcpClient } from 'autotel-mcp/client'
import { init, trace, shutdown } from 'autotel'
import { ConsoleSpanExporter } from 'autotel/exporters'
import { SimpleSpanProcessor } from 'autotel/processors'

// Initialize OpenTelemetry with console exporter for demo
init({
  service: 'mcp-weather-client',
  spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter()),
})

console.log('=== MCP Weather Client Example ===\n')

// Create MCP client
const client = new Client(
  {
    name: 'weather-client',
    version: '1.0.0',
  },
  {
    capabilities: {},
  }
)

// Instrument the client with autotel-mcp (OTel MCP semantic conventions)
const instrumented = instrumentMcpClient(client, {
  networkTransport: 'pipe',
  captureToolArgs: true,
  captureToolResults: true, // Enabled for demo
  captureErrors: true,
})

// Connect to the server via stdio
const serverPath = new URL(
  '../../example-mcp-server/src/index.ts',
  import.meta.url
).pathname

console.log(`Connecting to server: ${serverPath}\n`)

const transport = new StdioClientTransport({
  command: 'tsx',
  args: [serverPath],
})

await client.connect(transport)

console.log('Connected to MCP Weather Server!\n')

// Wrap all examples in a root trace to demonstrate distributed tracing
const runExamples = trace((ctx) => async () => {
  // Example 1: Discovery - list available tools
  // Span: "tools/list" with mcp.method.name: "tools/list"
  console.log('--- Example 1: Discover Available Tools ---')
  const tools = await instrumented.listTools()
  console.log(
    '\nAvailable tools:',
    tools.tools.map((t: any) => t.name).join(', ')
  )

  // Example 2: Tool call with automatic tracing
  // Span: "tools/call get_weather" with gen_ai.tool.name, gen_ai.operation.name
  console.log('\n--- Example 2: Get Weather for New York ---')
  const result1 = await instrumented.callTool({
    name: 'get_weather',
    arguments: { location: 'New York' },
  })

  console.log('\nResult:', JSON.stringify(result1, null, 2))

  // Example 3: Multiple tool calls (both traced automatically)
  console.log('\n--- Example 3: Get Forecast for London ---')
  const weather = await instrumented.callTool({
    name: 'get_weather',
    arguments: { location: 'London' },
  })

  const forecast = await instrumented.callTool({
    name: 'get_forecast',
    arguments: { location: 'London', days: 3 },
  })

  console.log('\nWeather:', JSON.stringify(weather, null, 2))
  console.log('\nForecast:', JSON.stringify(forecast, null, 2))

  // Example 4: Error handling
  // Span will have error.type: 'tool_error' on the server side
  console.log('\n--- Example 4: Error Handling ---')
  const errorResult = await instrumented.callTool({
    name: 'get_weather',
    arguments: { location: 'Atlantis' },
  })

  console.log('\nError result:', JSON.stringify(errorResult, null, 2))
  if (errorResult.isError) {
    console.log('Server returned error (server still running):', errorResult.content[0].text)
  }

  console.log('\n=== Distributed Tracing Demo Complete ===')
  console.log('\nSpec-Compliant Spans:')
  console.log('- Span names: "tools/list", "tools/call get_weather"')
  console.log('- Attributes: mcp.method.name, gen_ai.tool.name, network.transport')
  console.log('- Span kinds: CLIENT (client) / SERVER (server)')
  console.log('- Metrics: mcp.client.operation.duration, mcp.server.operation.duration')
  console.log(
    '- All traces visible in OTLP backend (Honeycomb, Datadog, etc.)\n'
  )
})

await runExamples()

// Cleanup: close client and flush pending spans
await client.close()
await shutdown()

console.log('Client shutdown complete.')
