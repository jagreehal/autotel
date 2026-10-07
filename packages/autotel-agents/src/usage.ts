/**
 * Token and cost usage as a question an agent can ask: "what did that session,
 * that prompt, or that repository spend?" Every total carries how complete it
 * is, because a coding agent that reads `$0` will repeat it as fact.
 */

import { accountingStatus, emptyUsage, mergeUsage } from './reduce';
import type {
  AccountingStatus,
  AgentKind,
  AgentSession,
  UsageBreakdown,
} from './types';

export interface UsageFilter {
  sessionId?: string;
  /** `prompt.id` (Claude Code) or `turn.id` (Codex). */
  promptId?: string;
  /** Repository name or path, as the SessionStart hook reported it. */
  repository?: string;
  agent?: AgentKind;
  /**
   * Narrow to the most recent `session`, or to the most recent `prompt` of the
   * most recent session — "the last thing I asked it to do".
   */
  latest?: 'session' | 'prompt';
}

export interface UsageCompleteness {
  cost: AccountingStatus;
  tokens: AccountingStatus;
}

export interface SessionUsage extends UsageCompleteness {
  id: string;
  agent: AgentKind;
  repository?: { name: string; path?: string };
  firstSeen: number;
  lastSeen: number;
  /** The prompt the session worked on last, when the agent tags requests. */
  latestPromptId?: string;
  /** The session's usage, or one prompt's when the filter names a prompt. */
  usage: UsageBreakdown;
}

export interface UsageReport extends UsageCompleteness {
  sessions: SessionUsage[];
  total: UsageBreakdown;
  /**
   * Sessions a repository filter left out because they never reported a
   * repository. They may belong to it; nothing proves they do.
   */
  uncorrelatedSessions: number;
}

function completeness(usage: UsageBreakdown): UsageCompleteness {
  return {
    cost: accountingStatus(usage.requests, usage.unpriced),
    tokens: accountingStatus(usage.requests, usage.untokened),
  };
}

function sessionTotal(session: AgentSession): UsageBreakdown {
  const { rollup } = session;
  return {
    requests: rollup.apiRequests,
    costUsd: rollup.costUsd,
    inputTokens: rollup.inputTokens,
    outputTokens: rollup.outputTokens,
    cacheReadTokens: rollup.cacheReadTokens,
    cacheCreationTokens: rollup.cacheCreationTokens,
    unpriced: rollup.unpricedRequests,
    untokened: rollup.untokenedRequests,
  };
}

export function usageReport(
  sessions: Iterable<AgentSession>,
  filter: UsageFilter = {},
): UsageReport {
  let uncorrelated = 0;
  let matched = [...sessions].filter((session) => {
    if (filter.sessionId && session.id !== filter.sessionId) return false;
    if (filter.agent && session.agent !== filter.agent) return false;
    if (filter.repository) {
      if (!session.repository) {
        uncorrelated += 1;
        return false;
      }
      const { name, path } = session.repository;
      if (filter.repository !== name && filter.repository !== path)
        return false;
    }
    return true;
  });
  matched.sort((a, b) => b.lastSeen - a.lastSeen);
  if (filter.latest) matched = matched.slice(0, 1);

  const rows: SessionUsage[] = [];
  for (const session of matched) {
    const { latestPromptId } = session;
    const promptId =
      filter.promptId ??
      (filter.latest === 'prompt' ? latestPromptId : undefined);
    // Asked for a prompt and none is known: report nothing for this session
    // rather than its whole spend under a prompt's name.
    if (filter.latest === 'prompt' && !promptId) continue;
    const usage = promptId
      ? session.rollup.byPrompt[promptId]
      : sessionTotal(session);
    if (!usage) continue;
    rows.push({
      id: session.id,
      agent: session.agent,
      repository: session.repository,
      firstSeen: session.firstSeen,
      lastSeen: session.lastSeen,
      latestPromptId,
      usage,
      ...completeness(usage),
    });
  }

  const totals = { all: emptyUsage() };
  for (const row of rows) mergeUsage(totals, { all: row.usage });
  const total = totals.all;
  return {
    sessions: rows,
    total,
    ...completeness(total),
    uncorrelatedSessions: uncorrelated,
  };
}
