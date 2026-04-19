import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry';
import type { RuntimeSignalAvailability } from '../modules/signal-availability';
import {
  buildCapabilitiesText,
  buildToolCatalogText,
  buildVerificationGuide,
  buildCollectorGuide,
  buildInstrumentationGuide,
} from '../modules/docs';
import {
  listCollectorComponents,
  listCollectorVersions,
  resolveCollectorVersion,
} from '../modules/collector-catalog';
import { listSemanticConventionNamespaces } from '../modules/semantic-conventions';
import { listDashboards, readDashboard } from '../modules/dashboards';

const SERVER_NAME = 'autotel-mcp';

export function registerResources(
  server: McpServer,
  backend: TelemetryBackend,
  runtimeAvailability?: RuntimeSignalAvailability,
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
          text: JSON.stringify(
            {
              declared: backend.capabilities(),
              runtime: runtimeAvailability ?? null,
            },
            null,
            2,
          ),
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

  server.registerResource(
    'otel-collector-versions',
    'otel://collector/versions',
    {
      title: `${SERVER_NAME} collector versions`,
      description: 'Version list for upstream collector component schemas.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'otel://collector/versions',
          text: JSON.stringify(
            { versions: await listCollectorVersions() },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    'otel-collector-components',
    'otel://collector/components',
    {
      title: `${SERVER_NAME} collector components`,
      description:
        'Collector component inventory for the latest schema version.',
      mimeType: 'application/json',
    },
    async () => {
      const version = await resolveCollectorVersion();
      const components = await listCollectorComponents(version);
      return {
        contents: [
          {
            uri: 'otel://collector/components',
            text: JSON.stringify({ version, components }, null, 2),
          },
        ],
      };
    },
  );

  // Dashboard catalog + individual dashboard payloads. Served as JSON so
  // agents can hand users a "copy-paste this into Grafana" answer.
  server.registerResource(
    'otel-dashboards',
    'otel://dashboards',
    {
      title: `${SERVER_NAME} dashboards index`,
      description:
        'List of prebuilt observability dashboards shipped with autotel-mcp.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'otel://dashboards',
          text: JSON.stringify({ dashboards: listDashboards() }, null, 2),
        },
      ],
    }),
  );

  for (const dashboard of listDashboards()) {
    const uri = `otel://dashboards/${dashboard.id}`;
    server.registerResource(
      `otel-dashboard-${dashboard.id}`,
      uri,
      {
        title: dashboard.title,
        description: dashboard.description,
        mimeType: 'application/json',
      },
      async () => ({
        contents: [{ uri, text: readDashboard(dashboard.id) }],
      }),
    );
  }

  server.registerResource(
    'otel-semconv-namespaces',
    'otel://semconv/namespaces',
    {
      title: `${SERVER_NAME} semantic convention namespaces`,
      description:
        'Available semantic-convention namespaces from upstream OTel model.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'otel://semconv/namespaces',
          text: JSON.stringify(
            { namespaces: await listSemanticConventionNamespaces() },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
