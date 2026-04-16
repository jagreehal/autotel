import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import {
  buildBackendCapabilitiesText,
  buildCapabilitiesText,
  buildToolCatalogText,
  buildVerificationGuide,
  buildCollectorGuide,
  buildInstrumentationGuide,
} from '../modules/docs.js';

const SERVER_NAME = 'autotel-mcp';

export function registerResources(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerResource(
    'otel-capabilities',
    'otel://capabilities',
    {
      title: `${SERVER_NAME} capabilities`,
      description: 'Capability inventory for the OTEL MCP server.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'otel://capabilities',
          text: buildCapabilitiesText(SERVER_NAME),
        },
      ],
    }),
  );

  server.registerResource(
    'otel-tool-catalog',
    'otel://tool-catalog',
    {
      title: `${SERVER_NAME} tool catalog`,
      description: 'Human-readable catalog of available tools.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{ uri: 'otel://tool-catalog', text: buildToolCatalogText() }],
    }),
  );

  server.registerResource(
    'otel-backend-capabilities',
    'otel://backend/capabilities',
    {
      title: `${SERVER_NAME} backend capabilities`,
      description: 'Capabilities of the active telemetry backend.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'otel://backend/capabilities',
          text: buildBackendCapabilitiesText(backend.capabilities()),
        },
      ],
    }),
  );

  server.registerResource(
    'otel-verification',
    'otel://verification',
    {
      title: `${SERVER_NAME} verification guide`,
      description: 'How to verify the server against Jaeger and fixtures.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        { uri: 'otel://verification', text: buildVerificationGuide() },
      ],
    }),
  );

  server.registerResource(
    'otel-collector-config',
    'otel://collector/config',
    {
      title: `${SERVER_NAME} collector config guide`,
      description: 'OTLP receiver configuration guidance.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        { uri: 'otel://collector/config', text: buildCollectorGuide() },
      ],
    }),
  );

  server.registerResource(
    'otel-instrumentation-scoring',
    'otel://instrumentation/scoring',
    {
      title: `${SERVER_NAME} instrumentation scoring guide`,
      description: 'How span instrumentation quality is scored.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'otel://instrumentation/scoring',
          text: buildInstrumentationGuide(),
        },
      ],
    }),
  );
}
