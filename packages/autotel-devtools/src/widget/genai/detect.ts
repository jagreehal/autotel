import type { SpanData } from '../types';

// A span belongs to the GenAI view if it carries any of the load-bearing
// semconv markers. These are stable across the migration from `gen_ai.system`
// (legacy) to `gen_ai.provider.name` (newer). We also accept `ai.model.provider`
// for Vercel AI SDK wrapper spans (the outer `ai.generateText`) which carry
// only AI-SDK-flavored attributes but represent the canonical user-visible call.
const GENAI_MARKERS = [
  'gen_ai.system',
  'gen_ai.provider.name',
  'gen_ai.operation.name',
  'ai.model.provider',
] as const;

export function isGenAiSpan(span: SpanData): boolean {
  const attrs = span.attributes ?? {};
  for (const key of GENAI_MARKERS) {
    if (attrs[key] != null) return true;
  }
  return false;
}

const toolOf = (s: SpanData) =>
  s.attributes?.['gen_ai.operation.name'] === 'execute_tool'
    ? s.attributes['gen_ai.tool.name']
    : undefined;

/**
 * MCP server tool spans that are the far end of a client tool span, as
 * server spanId → client spanId. Such a pair is one call seen from both ends
 * (the server's `tools/call` under the client's `execute_tool`), so the GenAI
 * list shows it once. A pair needs evidence of both ends (a SERVER-kind
 * `tools/call` under a non-server tool span), the same tool name, no
 * conflicting call ids, and must be the client's only such child: a tool that
 * calls itself, or calls twice, is several executions and is left alone.
 */
export function findMcpServerToolHalves(
  spans: SpanData[],
): Map<string, string> {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const byClient = new Map<string, string[]>();
  for (const server of spans) {
    if (server.kind !== 'SERVER') continue;
    if (server.attributes?.['mcp.method.name'] !== 'tools/call') continue;
    const client = server.parentSpanId
      ? byId.get(server.parentSpanId)
      : undefined;
    if (!client || client.kind === 'SERVER') continue;
    const name = toolOf(server);
    if (name == null || name !== toolOf(client)) continue;
    const serverCall = server.attributes['gen_ai.tool.call.id'];
    const clientCall = client.attributes['gen_ai.tool.call.id'];
    if (serverCall != null && clientCall != null && serverCall !== clientCall)
      continue;
    byClient.set(client.spanId, [
      ...(byClient.get(client.spanId) ?? []),
      server.spanId,
    ]);
  }
  const halves = new Map<string, string>();
  for (const [client, servers] of byClient) {
    if (servers.length === 1) halves.set(servers[0], client);
  }
  return halves;
}
