import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Toolset } from '../config';
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
import { registerEstimateTools } from './estimate';
import { registerAgentUsageTools } from './agent-usage';
import { registerLiveValidationTools } from './live-validation';
import { registerAnalyticsTools } from './analytics';
import { registerResources } from '../resources/index';
import type { RuntimeSignalAvailability } from '../modules/signal-availability';

export interface ToolSelection {
  /** Groups to register; `all` (the default) registers every group. */
  toolsets?: readonly string[];
  /** Tool names to leave out whatever their group. */
  omitTools?: readonly string[];
}

/**
 * The server as one toolset sees it: `registerTool` skips a tool the selection
 * leaves out, and makes every object input schema strict, so a misspelled
 * argument (`hasError` for `errorOnly`) comes back as an error naming it.
 */
function scoped(
  server: McpServer,
  toolset: Toolset,
  selection: ToolSelection,
): McpServer {
  const sets = selection.toolsets ?? ['all'];
  const enabled = sets.includes('all') || sets.includes(toolset);
  const omit = new Set(selection.omitTools);
  return new Proxy(server, {
    get(target, property) {
      if (property === 'registerTool') {
        return (...args: Parameters<McpServer['registerTool']>) => {
          const [name, config, callback] = args;
          if (!enabled || omit.has(name)) return;
          const schema = config.inputSchema;
          const strict =
            schema instanceof z.ZodObject
              ? { inputSchema: schema.strict() }
              : {};
          // SAFETY: `.strict()` returns the same ZodObject with unknown keys
          // rejected, so the config keeps the shape the caller passed.
          const scopedConfig = { ...config, ...strict } as typeof config;
          return target.registerTool(name, scopedConfig, callback);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function registerTools(
  rawServer: McpServer,
  backend: TelemetryBackend,
  runtimeAvailability?: RuntimeSignalAvailability,
  selection: ToolSelection = {},
): void {
  const caps = backend.capabilities();
  const server = scoped(rawServer, 'core', selection);
  const llm = scoped(rawServer, 'llm', selection);
  const collector = scoped(rawServer, 'collector', selection);
  const semconv = scoped(rawServer, 'semconv', selection);
  const estimate = scoped(rawServer, 'estimate', selection);

  // Always-on: health, collector config, and instrumentation scoring rubric
  // don't depend on live signal availability.
  registerHealthTools(server, backend);
  registerCollectorConfigTools(collector);
  registerCollectorSchemaTools(collector);
  registerInstrumentationTools(semconv, backend);
  registerSemanticConventionTools(semconv);
  // Pure arithmetic over caller-supplied figures — no backend, no signals.
  registerEstimateTools(estimate);
  // Answers for itself when the backend keeps no agent sessions.
  registerAgentUsageTools(llm, backend);
  registerLiveValidationTools(semconv, backend);

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
    registerLlmAnalyticsTools(llm, backend);
    registerDiagnosisTools(server, backend);
    registerCorrelationTools(server, backend);
  }

  // Metric + log tools gate themselves inside registerSignalTools.
  registerSignalTools(server, backend, {
    metrics: metricsEnabled,
    logs: logsEnabled,
  });

  registerAnalyticsTools(server, backend, {
    traces: tracesEnabled,
    logs: logsEnabled,
  });

  registerDiscoveryTools(server, backend, {
    traces: tracesEnabled,
    logs: logsEnabled,
    metrics: metricsEnabled,
  });

  registerResources(rawServer, backend, runtimeAvailability);
}
