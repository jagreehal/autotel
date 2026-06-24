/**
 * Factory for "Claude-Code-shaped" agents. Claude Code, opencode and (soon)
 * Codex emit the *same* instrument and event names under different prefixes and
 * instrumentation scopes — opencode literally mirrors Claude Code's contract
 * with an `opencode.` prefix. So one parameterized adapter covers them all, and
 * a new agent is `createPrefixAdapter({ kind, prefix, scopeHint })`.
 */

import { bool, num, str } from '../attrs';
import { estimateCostUsd } from '../cost';
import { mergeAttrs, readIdentity } from '../identity';
import { parseToolName } from '../mcp';
import { classifyTool, readSkillName, readSubAgentType } from '../tool-taxonomy';
import type {
  AgentEvent,
  AgentEventType,
  AgentRawEvent,
  Attributes,
  ToolRef,
  OtelMetricRecord,
} from '../types';
import type {
  AgentAdapter,
  AgentMetricKind,
  AgentMetricSignal,
} from './types';

export interface PrefixAdapterConfig {
  kind: AgentAdapter['kind'];
  /** e.g. `"claude_code."` or `"opencode."`. */
  prefix: string;
  /** Substring expected in the instrumentation scope name, e.g. `"claude_code"`. */
  scopeHint: string;
  /** Expected `service.name` resource value, e.g. `"claude-code"`. */
  serviceHint: string;
}

const EVENT_SUFFIXES: Record<string, AgentEventType> = {
  user_prompt: 'user_prompt',
  api_request: 'api_request',
  api_error: 'api_error',
  tool_result: 'tool_result',
  tool_decision: 'tool_decision',
};

/** Compose a full ToolRef: MCP split + category + (defensive) sub-agent/skill id. */
function buildToolRef(name: string, attrs: Attributes): ToolRef {
  const category = classifyTool(name);
  const ref: ToolRef = { ...parseToolName(name), category };
  if (category === 'subagent') {
    const subAgentType = readSubAgentType(attrs);
    if (subAgentType) ref.subAgentType = subAgentType;
  } else if (category === 'skill') {
    const skillName = readSkillName(attrs);
    if (skillName) ref.skillName = skillName;
  }
  return ref;
}

// Only the metric-only signals get a kind; overlapping metrics (token/cost/
// code_edit decision/session) fall through to 'other' and are not folded.
const METRIC_SUFFIXES: Record<string, AgentMetricKind> = {
  'lines_of_code.count': 'lines_of_code',
  'commit.count': 'commit',
  'pull_request.count': 'pull_request',
  'active_time.total': 'active_time',
};

export function createPrefixAdapter(config: PrefixAdapterConfig): AgentAdapter {
  const { kind, prefix, scopeHint, serviceHint } = config;

  // Detection must rest on a POSITIVE agent signal — the metric/event name
  // prefix, the instrumentation scope, or the resource service.name. We never
  // match on a bare `event.name` like "api_request", because any application's
  // logs could carry that and would otherwise be misattributed as agent sessions.
  const scopeMatches = (scopeName?: string): boolean =>
    typeof scopeName === 'string' && scopeName.includes(scopeHint);
  const serviceMatches = (resource: Attributes): boolean => {
    const service = str(resource, 'service.name');
    return service !== undefined && service.includes(serviceHint);
  };

  /** Suffix after the agent prefix, e.g. `"claude_code.api_request"` → `"api_request"`. */
  const suffixOf = (name: string): string =>
    name.startsWith(prefix) ? name.slice(prefix.length) : name;

  return {
    kind,

    matchesMetric(record: OtelMetricRecord): boolean {
      return (
        record.name.startsWith(prefix) ||
        scopeMatches(record.scope?.name) ||
        serviceMatches(record.resource)
      );
    },

    matchesEvent(record: AgentRawEvent): boolean {
      return (
        record.eventName.startsWith(prefix) ||
        scopeMatches(record.scope?.name) ||
        serviceMatches(record.resource)
      );
    },

    normalizeEvent(record: AgentRawEvent): AgentEvent | null {
      const attrs = mergeAttrs(record.resource, record.attributes);
      const rawName =
        suffixOf(record.eventName) || str(attrs, 'event.name') || record.eventName;
      const type = EVENT_SUFFIXES[rawName] ?? 'other';
      const sessionId = str(attrs, 'session.id');
      if (!sessionId) return null;

      const event: AgentEvent = {
        id: `${sessionId}:0`, // real id assigned by the reducer (uses session.eventCount)
        sessionId,
        agent: kind,
        type,
        rawEventName: rawName,
        timestamp: record.timestamp,
        model: str(attrs, 'model'),
        attributes: record.attributes,
      };

      switch (type) {
        case 'api_request': {
          event.inputTokens = num(attrs, 'input_tokens');
          event.outputTokens = num(attrs, 'output_tokens');
          event.cacheReadTokens = num(attrs, 'cache_read_tokens');
          event.cacheCreationTokens = num(attrs, 'cache_creation_tokens');
          event.durationMs = num(attrs, 'duration_ms');
          const reported = num(attrs, 'cost_usd', 'cost');
          if (reported === undefined) {
            const estimated = estimateCostUsd(event.model, event.inputTokens, event.outputTokens);
            if (estimated !== undefined) {
              event.costUsd = estimated;
              event.costSource = 'estimated';
            }
          } else {
            event.costUsd = reported;
            event.costSource = 'reported';
          }
          break;
        }
        case 'api_error': {
          event.errorMessage = str(attrs, 'error', 'error.message', 'message');
          event.statusCode = num(attrs, 'status_code', 'http.status_code');
          event.durationMs = num(attrs, 'duration_ms');
          break;
        }
        case 'tool_result': {
          const toolName = str(attrs, 'tool_name', 'name', 'tool');
          if (toolName) event.tool = buildToolRef(toolName, attrs);
          event.success = bool(attrs, 'success');
          event.durationMs = num(attrs, 'duration_ms');
          const decision = str(attrs, 'decision');
          if (decision === 'accept' || decision === 'reject') event.decision = decision;
          break;
        }
        case 'tool_decision': {
          const toolName = str(attrs, 'tool_name', 'name', 'tool');
          if (toolName) event.tool = buildToolRef(toolName, attrs);
          const decision = str(attrs, 'decision');
          if (decision === 'accept' || decision === 'reject') event.decision = decision;
          break;
        }
        case 'user_prompt': {
          event.promptLength = num(attrs, 'prompt_length', 'prompt.length');
          const text = str(attrs, 'prompt');
          if (text) event.promptText = text;
          break;
        }
        default: {
          break;
        }
      }

      return event;
    },

    normalizeMetric(record: OtelMetricRecord): AgentMetricSignal[] {
      const kindOfMetric = METRIC_SUFFIXES[suffixOf(record.name)] ?? 'other';
      return record.dataPoints.map((point) => {
        const attrs = mergeAttrs(record.resource, point.attributes);
        return {
          agent: kind,
          sessionId: str(attrs, 'session.id'),
          identity: readIdentity(attrs),
          kind: kindOfMetric,
          value: point.value,
          temporality: record.temporality,
          timestamp: point.timestamp,
          attributes: point.attributes,
        } satisfies AgentMetricSignal;
      });
    },
  };
}
