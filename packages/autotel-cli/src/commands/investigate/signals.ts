import {
  toMetricSearchQuery,
  toLogSearchQuery,
  type MetricsQueryInput,
  type LogsQueryInput,
} from 'autotel-mcp';
import { runInvestigate, type InvestigateFlags } from './runtime';

export type QueryMetricsFlags = InvestigateFlags & MetricsQueryInput;
export type QueryLogsFlags = InvestigateFlags & LogsQueryInput;

export async function runQueryMetrics(flags: QueryMetricsFlags): Promise<void> {
  await runInvestigate('query metrics', flags, async (backend) =>
    backend.listMetrics(toMetricSearchQuery(flags)),
  );
}

export async function runQueryLogs(flags: QueryLogsFlags): Promise<void> {
  await runInvestigate('query logs', flags, async (backend) =>
    backend.searchLogs(toLogSearchQuery(flags)),
  );
}
