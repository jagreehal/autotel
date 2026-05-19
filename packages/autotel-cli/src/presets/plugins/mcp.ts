import type { PluginPreset } from '../../types/index';

/**
 * MCP preset — instruments Model Context Protocol servers (and optionally
 * clients) using `instrumentMcpServer` / `instrumentMcpClient`.
 *
 * Like Hono, this is a "next-step" preset — we can't wrap the user's MCP
 * server instance from the instrumentation file because the user constructs
 * it. We emit the import and a clear snippet.
 */
export const mcp: PluginPreset = {
  name: 'MCP (Model Context Protocol)',
  slug: 'mcp',
  type: 'plugin',
  description:
    'Distributed tracing for MCP servers and clients (W3C trace context via _meta)',
  packages: {
    required: ['autotel-mcp-instrumentation'],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-mcp-instrumentation',
      specifiers: ['instrumentMcpServer'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: `// Wrap your MCP server after constructing it:
//   const instrumented = instrumentMcpServer(server, {
//     networkTransport: 'pipe',
//     captureToolArgs: true,
//     captureToolResults: false,
//     captureErrors: true,
//   });
//
// For clients, import { instrumentMcpClient } and wrap the client.`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Wrap your MCP server with instrumentMcpServer(server, { ... })',
    'For clients, use instrumentMcpClient from autotel-mcp-instrumentation',
    'Traces follow OTel MCP semantic conventions and propagate via the _meta field',
  ],
};
