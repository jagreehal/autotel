export interface ToolCatalogEntry {
  name: string;
  description: string;
  intent: string;
}

export function buildToolCatalog(): ToolCatalogEntry[] {
  return [
    {
      name: 'backend_health',
      description: 'Check backend health and readiness.',
      intent: 'confirm the backend is reachable',
    },
    {
      name: 'backend_capabilities',
      description:
        'Describe which telemetry signals the active backend can serve.',
      intent: 'see supported signals',
    },
    {
      name: 'list_services',
      description: 'List known services.',
      intent: 'discover services',
    },
    {
      name: 'list_operations',
      description: 'List operations for a service.',
      intent: 'discover service operations',
    },
    {
      name: 'search_traces',
      description:
        'Search traces by service, operation, status, tags, time window, and error flag.',
      intent: 'investigate traces',
    },
    {
      name: 'search_spans',
      description:
        'Search spans by service, operation, status, tags, time window, duration, and error flag.',
      intent: 'investigate spans',
    },
    {
      name: 'get_trace',
      description: 'Get a trace by trace ID.',
      intent: 'open one trace',
    },
    {
      name: 'summarize_trace',
      description: 'Summarize a trace into a compact incident-friendly view.',
      intent: 'read a trace summary',
    },
    {
      name: 'get_llm_usage',
      description: 'Aggregate LLM token usage by model and service.',
      intent: 'track token usage',
    },
    {
      name: 'find_errors',
      description: 'Find traces with error spans and extract error details.',
      intent: 'debug failures',
    },
    {
      name: 'list_llm_models',
      description: 'Discover LLM models in use and their usage frequency.',
      intent: 'track model adoption',
    },
    {
      name: 'get_llm_model_stats',
      description:
        'Get latency, token, and error statistics for one LLM model.',
      intent: 'compare model efficiency',
    },
    {
      name: 'get_llm_expensive_traces',
      description: 'Find traces with the highest total LLM token usage.',
      intent: 'optimize cost',
    },
    {
      name: 'get_llm_slow_traces',
      description: 'Find the slowest traces that include LLM spans.',
      intent: 'optimize latency',
    },
    {
      name: 'list_llm_tools',
      description: 'Discover tool/function spans and group them by tool name.',
      intent: 'see tool usage',
    },
    {
      name: 'service_map',
      description:
        'Build a service dependency map with node and edge health metrics.',
      intent: 'see dependencies',
    },
    {
      name: 'list_metrics',
      description: 'List metric series if the backend supports metrics.',
      intent: 'inspect metrics',
    },
    {
      name: 'search_logs',
      description: 'Search logs if the backend supports logs.',
      intent: 'inspect logs',
    },
    {
      name: 'validate_collector_config',
      description: 'Validate an OTLP receiver collector config fragment.',
      intent: 'check collector config',
    },
    {
      name: 'explain_collector_config',
      description:
        'Explain the OTLP receiver collector config shape and defaults.',
      intent: 'learn collector config',
    },
    {
      name: 'suggest_collector_config',
      description: 'Suggest a minimal OTLP receiver collector config.',
      intent: 'generate collector config',
    },
    {
      name: 'score_span_instrumentation',
      description:
        'Score a span for instrumentation quality and semantic convention coverage.',
      intent: 'score instrumentation',
    },
    {
      name: 'explain_instrumentation_score',
      description: 'Explain the instrumentation scoring rubric and fix ideas.',
      intent: 'understand instrumentation scoring',
    },
  ];
}
