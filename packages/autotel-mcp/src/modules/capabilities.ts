export interface ServerCapabilityGroup {
  name: string;
  description: string;
  tools: string[];
  resources: string[];
}

export interface ServerCapabilitiesDocument {
  serverName: string;
  transportModes: string[];
  groups: ServerCapabilityGroup[];
}

export function buildCapabilitiesDocument(
  serverName: string,
): ServerCapabilitiesDocument {
  return {
    serverName,
    transportModes: ['stdio', 'http', 'sse'],
    groups: [
      {
        name: 'investigation',
        description:
          'Ask live telemetry questions and inspect traces, spans, services, service maps, backend capabilities, and LLM analytics.',
        tools: [
          'backend_health',
          'backend_capabilities',
          'discover_services',
          'list_services',
          'list_operations',
          'search_traces',
          'search_spans',
          'get_trace',
          'summarize_trace',
          'service_map',
          'get_llm_usage',
          'find_errors',
          'list_llm_models',
          'get_llm_model_stats',
          'get_llm_expensive_traces',
          'get_llm_slow_traces',
          'list_llm_tools',
        ],
        resources: [
          'otel://tool-catalog',
          'otel://verification',
          'otel://capabilities',
          'otel://backend/capabilities',
          'otel://semconv/namespaces',
        ],
      },
      {
        name: 'signals',
        description:
          'Probe metrics and logs through the same backend abstraction, with fixture-backed support for local development.',
        tools: [
          'list_metrics',
          'search_logs',
          'discover_trace_fields',
          'discover_log_fields',
        ],
        resources: ['otel://backend/capabilities'],
      },
      {
        name: 'collector',
        description:
          'Validate and explain OTLP receiver collector config fragments.',
        tools: [
          'validate_collector_config',
          'suggest_collector_config',
          'explain_collector_config',
          'collector_get_versions',
          'collector_list_components',
          'collector_component_schema',
          'collector_component_readme',
          'collector_validate_component_config',
          'collector_refresh_catalog',
        ],
        resources: [
          'otel://collector/config',
          'otel://collector/versions',
          'otel://collector/components',
        ],
      },
      {
        name: 'instrumentation',
        description:
          'Score instrumentation quality and suggest semantic-convention improvements.',
        tools: [
          'score_span_instrumentation',
          'explain_instrumentation_score',
          'semconv_list_namespaces',
          'semconv_get_namespace',
          'semconv_refresh_cache',
        ],
        resources: ['otel://instrumentation/scoring'],
      },
    ],
  };
}
