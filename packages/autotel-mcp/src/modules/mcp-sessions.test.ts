import { describe, expect, it } from 'vitest';
import type { SpanRecord, TagValue } from '../types';
import { analyzeMcpSessions } from './mcp-sessions';

let clock = 1_700_000_000_000;
let ids = 0;

function call(
  session: string | undefined,
  tool: string,
  tags: Record<string, TagValue> = {},
  hasError = false,
): SpanRecord {
  clock += 1000;
  ids++;
  const spanTags = new Map<string, TagValue>([
    ['mcp.method.name', 'tools/call'],
    ['gen_ai.tool.name', tool],
    ['span.kind', 'server'],
  ]);
  if (session) spanTags.set('gen_ai.conversation.id', session);
  return {
    traceId: `t${ids}`,
    spanId: `s${ids}`,
    parentSpanId: null,
    operationName: `tools/call ${tool}`,
    serviceName: 'crm-mcp',
    startTimeUnixMs: clock,
    durationMs: 20,
    statusCode: hasError ? 'ERROR' : 'OK',
    hasError,
    tags: { ...Object.fromEntries(spanTags), ...tags },
  };
}

describe('analyzeMcpSessions', () => {
  it('does not call an overlapping late failure recovered before it finished', () => {
    const slowFailure = call(
      'parallel-failure',
      'slow_lookup',
      {
        'mcp.failure.category': 'timeout',
      },
      true,
    );
    slowFailure.durationMs = 10_000;
    const fastSuccess = call('parallel-failure', 'fast_lookup');
    const report = analyzeMcpSessions([slowFailure, fastSuccess]);
    expect(report.sessions[0]!.outcome).toBe('failed');
    expect(report.endedOn).toEqual([
      { tool: 'slow_lookup', failureCategory: 'timeout', sessions: 1 },
    ]);
  });

  it('ends a session when its last overlapping tool call finishes', () => {
    const slow = call('parallel', 'slow_lookup');
    slow.durationMs = 10_000;
    const fast = call('parallel', 'fast_lookup');
    const [session] = analyzeMcpSessions([slow, fast]).sessions;
    expect(session!.endTimeUnixMs).toBe(slow.startTimeUnixMs + slow.durationMs);
  });

  it('excludes missing-tool reports from sessions removed by the filter', () => {
    const spans = [
      call('selected', 'search_contacts'),
      call('excluded', 'get_more_tools', {
        'mcp.missing_tool.description': "Export another user's private account",
      }),
    ];
    const report = analyzeMcpSessions(
      spans,
      (session) => session.id === 'selected',
    );
    expect(report.sessions.map((session) => session.id)).toEqual(['selected']);
    expect(report.missingTools).toEqual([]);
  });

  it('rebuilds sessions in call order with intent, user and outcome', () => {
    const spans = [
      call('a', 'search_contacts', {
        'mcp.tool.call.intent': 'Find the account owner for the renewal.',
        'user.id': 'u1',
        'mcp.client.name': 'claude-code',
      }),
      call(
        'a',
        'update_contact',
        { 'mcp.failure.category': 'validation' },
        true,
      ),
      call('a', 'update_contact'),
      call('b', 'search_contacts', { 'user.id': 'u2' }),
      call('b', 'delete_contact', { 'mcp.failure.category': 'auth' }, true),
      call(undefined, 'search_contacts'),
    ].toReversed();

    const report = analyzeMcpSessions(spans);
    const a = report.sessions.find((s) => s.id === 'a')!;
    expect(a.path).toEqual(['search_contacts', 'update_contact']);
    expect(a.outcome).toBe('recovered');
    expect(a.errors).toBe(1);
    expect(a.userId).toBe('u1');
    expect(a.client).toBe('claude-code');
    expect(a.calls[0]!.intent).toBe('Find the account owner for the renewal.');

    expect(report.sessions.find((s) => s.id === 'b')!.outcome).toBe('failed');
    expect(report.endedOn).toEqual([
      { tool: 'delete_contact', failureCategory: 'auth', sessions: 1 },
    ]);
    expect(report.unsessionedCalls).toBe(1);
    expect(report.outcomes).toMatchObject({
      recovered: 1,
      failed: 1,
      completed: 0,
    });
  });

  it('groups sessions that took the same path', () => {
    const spans = ['x', 'y', 'z'].flatMap((id) => [
      call(id, 'list_invoices', { 'mcp.tool.call.intent': `Intent ${id}` }),
      call(id, 'send_invoice', {}, id === 'z'),
    ]);
    const [top] = analyzeMcpSessions(spans).patterns;
    expect(top!.path).toEqual(['list_invoices', 'send_invoice']);
    expect(top!.sessions).toBe(3);
    expect(top!.completionRate).toBeCloseTo(2 / 3);
    expect(top!.intents).toHaveLength(3);
  });

  it('reads pauses, missing tools and transport sessions', () => {
    const spans = [
      call(undefined, 'book_meeting', {
        'mcp.session.id': 'p',
        'mcp.input_required': true,
      }),
      call('m', 'get_more_tools', {
        'mcp.missing_tool.description': 'Export contacts as CSV',
      }),
    ];
    const report = analyzeMcpSessions(spans);
    expect(report.sessions.find((s) => s.id === 'p')!.outcome).toBe('paused');
    expect(report.sessions.find((s) => s.id === 'm')!.outcome).toBe(
      'missing_tool',
    );
    expect(report.missingTools).toEqual([
      { description: 'Export contacts as CSV', reports: 1 },
    ]);
  });

  it('counts a call once when both client and server traced it', () => {
    const server = call('c', 'search_contacts');
    const client: SpanRecord = {
      ...server,
      spanId: 'client-span',
      tags: { ...server.tags, 'span.kind': 'client' },
    };
    server.parentSpanId = 'client-span';
    expect(
      analyzeMcpSessions([client, server]).sessions[0]!.calls,
    ).toHaveLength(1);
  });

  it('builds patterns from the sessions a filter keeps', () => {
    const spans = [call('k', 'a'), call('k', 'b'), call('d', 'a', {}, true)];
    const report = analyzeMcpSessions(spans, (s) => s.outcome === 'failed');
    expect(report.sessions.map((s) => s.id)).toEqual(['d']);
    expect(report.patterns).toHaveLength(1);
  });
});
