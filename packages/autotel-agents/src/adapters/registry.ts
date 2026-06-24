import type { AgentRawEvent, OtelMetricRecord } from '../types';
import { claudeCodeAdapter } from './claude-code';
import { opencodeAdapter } from './opencode';
import type { AgentAdapter } from './types';

/**
 * Ordered adapter registry. First match claims the record. Claude Code is most
 * specific (dedicated scope), so it leads. Add Codex here when its contract
 * lands — one line, no other changes.
 */
export const adapters: readonly AgentAdapter[] = [claudeCodeAdapter, opencodeAdapter];

export function detectAdapterForMetric(record: OtelMetricRecord): AgentAdapter | undefined {
  return adapters.find((adapter) => adapter.matchesMetric(record));
}

export function detectAdapterForEvent(record: AgentRawEvent): AgentAdapter | undefined {
  return adapters.find((adapter) => adapter.matchesEvent(record));
}

/** True if any adapter recognizes this metric — used for zero-config "agent detected" toasts. */
export function isAgentMetric(record: OtelMetricRecord): boolean {
  return detectAdapterForMetric(record) !== undefined;
}

/** True if any adapter recognizes this log event. */
export function isAgentEvent(record: AgentRawEvent): boolean {
  return detectAdapterForEvent(record) !== undefined;
}
