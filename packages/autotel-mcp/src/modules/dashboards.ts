/**
 * Catalog of prebuilt observability dashboards shipped with autotel-mcp.
 *
 * Dashboard JSON is imported statically so tsup inlines it into the bundle
 * — no FS access at runtime. Dashboards are exposed via:
 *   - `otel://dashboards`              — index (this catalog)
 *   - `otel://dashboards/<id>`          — individual dashboard payload
 *
 * Agents can fetch a dashboard and hand the user a "copy-paste this into
 * Grafana → Dashboards → Import" answer.
 */

import grafanaLlmDashboard from '../resources/dashboards/grafana-llm.json' with { type: 'json' };

export interface DashboardEntry {
  id: string;
  title: string;
  description: string;
  format: 'grafana';
  tags: string[];
}

const CATALOG: Record<string, { entry: DashboardEntry; body: unknown }> = {
  'grafana-llm': {
    entry: {
      id: 'grafana-llm',
      title: 'LLM observability',
      description:
        'Grafana dashboard for autotel-instrumented LLM workloads. Panels: request rate, error rate, p50/p95/p99 latency, token throughput split by type, per-model breakdown. Assumes OTel GenAI semantic conventions exported to Prometheus. Pair with the `get_llm_usage` MCP tool for USD cost totals.',
      format: 'grafana',
      tags: ['llm', 'genai', 'latency', 'tokens'],
    },
    body: grafanaLlmDashboard,
  },
};

export function listDashboards(): DashboardEntry[] {
  return Object.values(CATALOG).map((item) => item.entry);
}

/** Returns the dashboard JSON as a pretty-printed string. */
export function readDashboard(id: string): string {
  const item = CATALOG[id];
  if (!item) throw new Error(`Unknown dashboard: ${id}`);
  return JSON.stringify(item.body, null, 2);
}
