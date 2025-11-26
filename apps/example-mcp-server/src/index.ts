#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { instrumentMcpServer } from 'autotel-mcp/server'
import { init } from 'autotel'
import { ConsoleSpanExporter } from 'autotel/exporters'
import { SimpleSpanProcessor } from 'autotel/processors'
import { z } from 'zod'

// Initialize OpenTelemetry with console exporter for demo
init({
  service: 'mcp-weather-server',
  spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter()),
})

console.error('Starting MCP Weather Server...')

// Create MCP server (using McpServer for high-level registerTool API)
const server = new McpServer(
  {
    name: 'weather-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Instrument the server with autotel-mcp
const instrumented = instrumentMcpServer(server, {
  captureArgs: true,
  captureResults: true, // Enabled for demo purposes
  captureErrors: true,
})

// Simulated weather data
const weatherData: Record<string, { temp: number; condition: string }> = {
  'new york': { temp: 72, condition: 'Sunny' },
  london: { temp: 61, condition: 'Cloudy' },
  tokyo: { temp: 68, condition: 'Rainy' },
  paris: { temp: 65, condition: 'Partly Cloudy' },
  sydney: { temp: 75, condition: 'Clear' },
}

// Register get_weather tool - automatically traced!
instrumented.registerTool(
  'get_weather',
  {
    description: 'Get current weather for a location',
    inputSchema: z.object({
      location: z.string().describe('City name (e.g., "New York", "London")'),
    }),
  },
  async (args) => {
    const location = (args.location as string).toLowerCase()

    // Simulate some async work
    await new Promise((resolve) => setTimeout(resolve, 100))

    const weather = weatherData[location]

    if (!weather) {
      // Return error response instead of throwing - prevents server crash
      return {
        content: [
          {
            type: 'text',
            text: `Error: Weather data not available for "${args.location}". Available locations: ${Object.keys(weatherData).join(', ')}`,
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Weather in ${args.location}:\nTemperature: ${weather.temp}°F\nCondition: ${weather.condition}`,
        },
      ],
    }
  }
)

// Register get_forecast tool - automatically traced!
instrumented.registerTool(
  'get_forecast',
  {
    description: 'Get weather forecast for multiple days',
    inputSchema: z.object({
      location: z.string().describe('City name'),
      days: z.number().min(1).max(7).describe('Number of days (1-7)'),
    }),
  },
  async (args) => {
    const location = args.location as string
    const days = args.days as number

    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 150))

    const forecast = Array.from({ length: days }, (_, i) => {
      const baseTemp = weatherData[location.toLowerCase()]?.temp ?? 70
      const temp = baseTemp + Math.floor(Math.random() * 10 - 5)
      return `Day ${i + 1}: ${temp}°F`
    }).join('\n')

    return {
      content: [
        {
          type: 'text',
          text: `${days}-day forecast for ${location}:\n${forecast}`,
        },
      ],
    }
  }
)

// Connect via stdio
const transport = new StdioServerTransport()
await server.connect(transport)

console.error('MCP Weather Server ready!')
