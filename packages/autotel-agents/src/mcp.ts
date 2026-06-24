/**
 * Tool-name parsing. Claude Code (and opencode) expose MCP tools to the model
 * under the `mcp__<server>__<tool>` convention, and those names flow through the
 * `tool_result` / `tool_decision` events. Splitting the name is what lets the
 * Agents tab answer "which MCP servers/tools is the agent actually using?".
 */

/** MCP-aware breakdown of a tool name (category is added by the taxonomy layer). */
export interface ParsedToolName {
  name: string;
  isMcp: boolean;
  mcpServer?: string;
  mcpTool?: string;
}

const MCP_PREFIX = 'mcp__';

export function parseToolName(name: string): ParsedToolName {
  if (!name.startsWith(MCP_PREFIX)) {
    return { name, isMcp: false };
  }
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf('__');
  if (sep === -1) {
    // `mcp__something` with no tool segment — treat the remainder as the server.
    return { name, isMcp: true, mcpServer: rest || undefined };
  }
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  return {
    name,
    isMcp: true,
    mcpServer: server || undefined,
    mcpTool: tool || undefined,
  };
}

export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_PREFIX);
}
