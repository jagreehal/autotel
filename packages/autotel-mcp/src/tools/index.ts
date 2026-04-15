import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import { registerHealthTools } from './health.js';
import { registerInvestigationTools } from './investigation.js';
import { registerTopologyTools } from './topology.js';
import { registerLlmAnalyticsTools } from './llm-analytics.js';
import { registerSignalTools } from './signals.js';
import { registerCollectorConfigTools } from './collector-config.js';
import { registerInstrumentationTools } from './instrumentation.js';
import { registerDiagnosisTools } from './diagnosis.js';
import { registerCorrelationTools } from './correlation.js';
import { registerResources } from '../resources/index.js';

export function registerTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  registerHealthTools(server, backend);
  registerInvestigationTools(server, backend);
  registerTopologyTools(server, backend);
  registerLlmAnalyticsTools(server, backend);
  registerSignalTools(server, backend);
  registerCollectorConfigTools(server);
  registerInstrumentationTools(server);
  registerDiagnosisTools(server, backend);
  registerCorrelationTools(server, backend);
  registerResources(server, backend);
}
