/**
 * Tool taxonomy. Claude Code reports every action the model takes as a tool
 * call (`tool_name` on `tool_result` / `tool_decision`), so the *kind* of work
 * an agent is doing is derivable from the name:
 *
 *   - sub-agents are the `Task` tool
 *   - skills are the `Skill` tool
 *   - MCP tools are `mcp__<server>__<tool>`
 *   - the rest are built-in file / shell / search / web / todo tools
 *
 * A tool call does not carry its own arguments, so the sub-agent type or skill
 * name is often absent here — they are read defensively and fall back to the
 * category count. The named attribution instead arrives on the *requests* the
 * sub-agent or skill goes on to make (`agent.name` / `skill.name` on
 * `api_request`), which is what the `byAgent` / `bySkill` breakdowns are built
 * from: that is where the cost is, too.
 */

import { str } from './attrs';
import { isMcpTool } from './mcp';
import type { Attributes } from './types';

export type ToolCategory =
  | 'file'
  | 'shell'
  | 'search'
  | 'web'
  | 'todo'
  | 'subagent'
  | 'skill'
  | 'mcp'
  | 'other';

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  'file',
  'shell',
  'search',
  'web',
  'todo',
  'subagent',
  'skill',
  'mcp',
  'other',
];

const BUILTIN = new Map<string, ToolCategory>([
  ['read', 'file'],
  ['edit', 'file'],
  ['write', 'file'],
  ['multiedit', 'file'],
  ['notebookedit', 'file'],
  ['bash', 'shell'],
  ['bashoutput', 'shell'],
  ['killshell', 'shell'],
  ['killbash', 'shell'],
  ['grep', 'search'],
  ['glob', 'search'],
  ['ls', 'search'],
  ['webfetch', 'web'],
  ['websearch', 'web'],
  ['todowrite', 'todo'],
  ['task', 'subagent'],
  ['agent', 'subagent'],
  ['skill', 'skill'],
]);

export function classifyTool(name: string): ToolCategory {
  if (isMcpTool(name)) return 'mcp';
  return BUILTIN.get(name.toLowerCase()) ?? 'other';
}

/** Sub-agent type, when the agent happens to emit it (defensive — often absent). */
export function readSubAgentType(attributes: Attributes): string | undefined {
  return str(attributes, 'subagent_type', 'agent_type', 'subagent.type');
}

/** Skill name, when present (defensive — often absent). */
export function readSkillName(attributes: Attributes): string | undefined {
  return str(attributes, 'skill', 'skill_name', 'skill.name');
}
