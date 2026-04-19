import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry';
import { registerHealthTools } from './health';
import { registerInvestigationTools } from './investigation';
import { registerTopologyTools } from './topology';
import { registerDiscoveryTools } from './discovery';
import { registerLlmAnalyticsTools } from './llm-analytics';
import { registerSignalTools } from './signals';
import { registerCollectorConfigTools } from './collector-config';
import { registerCollectorSchemaTools } from './collector-schema';
import { registerInstrumentationTools } from './instrumentation';
import { registerDiagnosisTools } from './diagnosis';
import { registerCorrelationTools } from './correlation';
import { registerSemanticConventionTools } from './semantic-conventions';
import { registerResources } from '../resources/index';
import type { RuntimeSignalAvailability } from '../modules/signal-availability';

export function registerTools(
  server: McpServer,
  backend: TelemetryBackend,
  runtimeAvailability?: RuntimeSignalAvailability,
): void {
  const caps = backend.capabilities();

  // Always-on: health, collector config, and instrumentation scoring rubric
  // don't depend on live signal availability.
  registerHealthTools(server, backend);
  registerCollectorConfigTools(server);
  registerCollectorSchemaTools(server);
  registerInstrumentationTools(server);
  registerSemanticConventionTools(server);

  const tracesEnabled =
    runtimeAvailability?.traces.enabled ?? caps.traces === 'available';
  const metricsEnabled =
    runtimeAvailability?.metrics.enabled ?? caps.metrics === 'available';
  const logsEnabled =
    runtimeAvailability?.logs.enabled ?? caps.logs === 'available';

  // Trace-dependent tools: skip if the backend doesn't carry traces.
  if (tracesEnabled) {
    registerInvestigationTools(server, backend);
    registerTopologyTools(server, backend);
    registerLlmAnalyticsTools(server, backend);
    registerDiagnosisTools(server, backend);
    registerCorrelationTools(server, backend);
  }

  // Metric + log tools gate themselves inside registerSignalTools.
  registerSignalTools(server, backend, {
    metrics: metricsEnabled,
    logs: logsEnabled,
  });

  registerDiscoveryTools(server, backend, {
    traces: tracesEnabled,
    logs: logsEnabled,
    metrics: metricsEnabled,
  });

  registerResources(server, backend, runtimeAvailability);
}
