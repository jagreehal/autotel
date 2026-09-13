import type { SpanAttributes } from '../types';

/**
 * Attributes worth a glance without opening the detail panel: the ones that
 * say *what* happened (route, query, model, tool, outcome) rather than who
 * emitted it. Order is display order; only keys present render.
 *
 * Shared by the waterfall hover card and the log rows, so one allowlist
 * decides what "at a glance" means everywhere.
 */
const KEY_ATTRIBUTES = [
  'http.request.method',
  'http.method',
  'http.route',
  'url.path',
  'http.response.status_code',
  'http.status_code',
  'db.system.name',
  'db.system',
  'db.operation.name',
  'db.query.text',
  'db.statement',
  'rpc.service',
  'rpc.method',
  'messaging.system',
  'messaging.destination.name',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.tool.name',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  // Claude Code events and spans (flat names)
  'model',
  'tool_name',
  'hook_event',
  'hook_name',
  'plugin.name',
  'server_name',
  'decision',
  'status',
  'success',
  'input_tokens',
  'output_tokens',
  'duration_ms',
  'cost_usd',
  'prompt_length',
  'error.type',
  'exception.type',
  'exception.message',
  'peer.service',
  'server.address',
] as const;

export function keyAttributes(
  attributes: SpanAttributes,
  max = Number.POSITIVE_INFINITY,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const key of KEY_ATTRIBUTES) {
    if (out.length >= max) break;
    const value = attributes[key];
    if (value === undefined || value === null) continue;
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    out.push([key, text.length > 120 ? `${text.slice(0, 120)}…` : text]);
  }
  return out;
}
