#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';
import {
  heuristicInjectionClassifier,
  MCP_CHAR_BUDGETS,
} from 'autotel-mcp-instrumentation/security';
import { init } from 'autotel';
import { SimpleSpanProcessor } from 'autotel/processors';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { z } from 'zod';

/**
 * Spans to **stderr**, not stdout.
 *
 * On a stdio MCP server, stdout IS the protocol wire: anything written there
 * that is not a JSON-RPC message corrupts the stream. `ConsoleSpanExporter`
 * writes to stdout, so it cannot be used here — the rule for a stdio server is
 * that stdout belongs to the protocol and every diagnostic goes to stderr.
 * (Over HTTP this does not apply, and the console exporter is fine.)
 */
const stderrSpanExporter: SpanExporter = {
  export(spans: ReadableSpan[], resultCallback) {
    for (const span of spans) {
      process.stderr.write(
        `${JSON.stringify({
          name: span.name,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanContext?.spanId,
          durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
          attributes: span.attributes,
        })}\n`,
      );
    }
    resultCallback({ code: 0 }); // ExportResultCode.SUCCESS
  },
  shutdown: async () => {},
};

// Telemetry first: OpenTelemetry must be initialised before anything you want
// traced is constructed. That is an OpenTelemetry rule, not an MCP one.
init({
  service: 'mcp-weather-server',
  spanProcessors: [new SimpleSpanProcessor(stderrSpanExporter)],
});

console.error('Starting MCP Weather Server...');

// Simulated weather data. Application state lives here, in a store this
// process owns — not in the protocol, which no longer has anywhere to put it.
const weatherData: Record<string, { temp: number; condition: string }> = {
  'new york': { temp: 72, condition: 'Sunny' },
  london: { temp: 61, condition: 'Cloudy' },
  tokyo: { temp: 68, condition: 'Rainy' },
  paris: { temp: 65, condition: 'Partly Cloudy' },
  sydney: { temp: 75, condition: 'Clear' },
};

/**
 * MCP 2026-07-28 removed the `initialize` handshake and the session header, so
 * a server instance has nothing worth keeping between requests. Both serving
 * entries build one from a factory instead: `serveStdio` once per connection,
 * `createMcpHandler` once per HTTP request. Define the tools once here and the
 * same factory serves either — and, because 2025-era clients are answered from
 * the same definitions, either protocol era too.
 */
function createServer() {
  const server = new McpServer(
    {
      name: 'weather-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      // The catalog is fixed and identical for every caller, so it is worth
      // holding. That matters more now that there is no session to amortise
      // the cost over.
      cacheHints: {
        'tools/list': { ttlMs: 300_000, cacheScope: 'public' },
        'server/discover': { ttlMs: 300_000, cacheScope: 'public' },
      },
    },
  );

  // Instrument BEFORE registering: `instrumentMcpServer` returns a Proxy, and
  // only registrations made through it get wrapped.
  const instrumented = instrumentMcpServer(server, {
    networkTransport: 'pipe',
    captureToolArgs: true,
    captureToolResults: true, // Enabled for demo purposes
    captureErrors: true,
    // --- Security observability (agentic-web threat model) ---
    // Annotation hints (mcp.tool.*) and payload sizes are captured automatically.
    // Add a prompt-injection classifier (swap for Model Armor / an LLM critic in prod):
    securityClassifier: heuristicInjectionClassifier(),
    // Flag tool outputs that overflow the WebMCP-recommended 1500-char budget:
    outputCharBudget: MCP_CHAR_BUDGETS.TOOL_OUTPUT,
  });

  // Register get_weather tool - automatically traced!
  // Span: "tools/call get_weather" with mcp.method.name, gen_ai.tool.name.
  // The parent context is read from ctx.mcpReq._meta, so this span joins the
  // client's trace across a protocol with no session tying the two together.
  instrumented.registerTool(
    'get_weather',
    {
      description: 'Get current weather for a location',
      inputSchema: z.object({
        location: z.string().describe('City name (e.g., "New York", "London")'),
      }),
      // Annotation hints surface the tool's trust profile on every span
      // (mcp.tool.read_only, mcp.tool.open_world). autotel also reads the WebMCP
      // `untrustedContentHint` once present — the MCP SDK type doesn't list it yet,
      // so set it via a cast in real code until the SDK catches up.
      annotations: {
        readOnlyHint: true,
        openWorldHint: true, // returns externally sourced data
      },
    },
    async ({ location }) => {
      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 100));

      const weather = weatherData[location.toLowerCase()];

      if (!weather) {
        // A tool-level failure is a RESULT with isError, not a thrown protocol
        // error: the model sees it and can recover. Traced with
        // error.type: 'tool_error'.
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Weather data not available for "${location}". Available locations: ${Object.keys(weatherData).join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Weather in ${location}:\nTemperature: ${weather.temp}°F\nCondition: ${weather.condition}`,
          },
        ],
      };
    },
  );

  // Register get_forecast tool - automatically traced!
  instrumented.registerTool(
    'get_forecast',
    {
      description: 'Get weather forecast for multiple days',
      inputSchema: z.object({
        location: z.string().describe('City name'),
        days: z.number().min(1).max(7).describe('Number of days (1-7)'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ location, days }) => {
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 150));

      const forecast = Array.from({ length: days }, (_, i) => {
        const baseTemp = weatherData[location.toLowerCase()]?.temp ?? 70;
        const temp = baseTemp + Math.floor(Math.random() * 10 - 5);
        return `Day ${i + 1}: ${temp}°F`;
      }).join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `${days}-day forecast for ${location}:\n${forecast}`,
          },
        ],
      };
    },
  );

  // Register a resource - traced with "resources/read"
  instrumented.registerResource(
    'weather_config',
    'weather://config',
    { description: 'Weather service configuration' },
    async () => {
      return {
        contents: [
          {
            uri: 'weather://config',
            text: JSON.stringify({
              availableLocations: Object.keys(weatherData),
              units: 'fahrenheit',
              updateFrequency: '5min',
            }),
          },
        ],
      };
    },
  );

  // Register a prompt - traced with "prompts/get weather_report"
  instrumented.registerPrompt(
    'weather_report',
    {
      description: 'Generate a weather report for a location',
      argsSchema: z.object({
        location: z.string().optional().describe('City name'),
      }),
    },
    async ({ location }) => {
      const place = location ?? 'New York';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please generate a detailed weather report for ${place} including current conditions and recommendations.`,
            },
          },
        ],
      };
    },
  );

  return instrumented;
}

// One instance per connection over stdio. `legacy` is left at its default
// ('serve'), so a 2025-era client is answered from the same definitions.
serveStdio(createServer, {
  onerror: (error) => console.error('[mcp-weather-server]', error.message),
});

console.error('MCP Weather Server ready!');
