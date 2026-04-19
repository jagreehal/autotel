import { describe, expect, it } from 'vitest';
import { listDashboards, readDashboard } from '../src/modules/dashboards';

describe('dashboards catalog', () => {
  it('lists the Grafana LLM dashboard entry', () => {
    const entries = listDashboards();
    expect(entries.length).toBeGreaterThan(0);
    const llm = entries.find((e) => e.id === 'grafana-llm');
    expect(llm).toBeDefined();
    expect(llm?.format).toBe('grafana');
    expect(llm?.tags).toContain('llm');
  });

  it('readDashboard returns a valid Grafana dashboard JSON body', () => {
    const text = readDashboard('grafana-llm');
    const parsed = JSON.parse(text) as {
      title: string;
      schemaVersion: number;
      panels: unknown[];
      templating: { list: unknown[] };
    };
    expect(parsed.title).toBe('autotel — LLM observability');
    expect(parsed.schemaVersion).toBeGreaterThanOrEqual(30);
    expect(parsed.panels.length).toBeGreaterThan(0);
    expect(parsed.templating.list.length).toBeGreaterThan(0);
  });

  it('panels use OTel GenAI Prometheus metric names', () => {
    const parsed = JSON.parse(readDashboard('grafana-llm')) as {
      panels: Array<{
        targets?: Array<{ expr?: string }>;
      }>;
    };
    const exprs = parsed.panels
      .flatMap((p) => p.targets ?? [])
      .map((t) => t.expr ?? '');
    const combined = exprs.join('\n');
    expect(combined).toContain('gen_ai_client_operation_duration');
    expect(combined).toContain('gen_ai_client_token_usage');
  });

  it('readDashboard throws for unknown id so MCP clients get a clear error', () => {
    expect(() => readDashboard('not-a-real-dashboard')).toThrow(/Unknown/);
  });
});
