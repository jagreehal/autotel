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
 * CC's native telemetry does NOT include tool *arguments*, so the specific
 * sub-agent type or skill name usually isn't present — we read them defensively
 * in case a future agent version (or another agent) adds them, and otherwise
 * fall back to the category count.
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

const BUILTIN: Record<string, ToolCategory> = {
  read: 'file',
  edit: 'file',
  write: 'file',
  multiedit: 'file',
  notebookedit: 'file',
  bash: 'shell',
  bashoutput: 'shell',
  killshell: 'shell',
  killbash: 'shell',
  grep: 'search',
  glob: 'search',
  ls: 'search',
  webfetch: 'web',
  websearch: 'web',
  todowrite: 'todo',
  task: 'subagent',
  agent: 'subagent',
  skill: 'skill',
};

export function classifyTool(name: string): ToolCategory {
  if (isMcpTool(name)) return 'mcp';
  return BUILTIN[name.toLowerCase()] ?? 'other';
}

/** Sub-agent type, when the agent happens to emit it (defensive — often absent). */
export function readSubAgentType(attributes: Attributes): string | undefined {
  return str(attributes, 'subagent_type', 'agent_type', 'subagent.type');
}

/** Skill name, when present (defensive — often absent). */
export function readSkillName(attributes: Attributes): string | undefined {
  return str(attributes, 'skill', 'skill_name', 'skill.name');
}
