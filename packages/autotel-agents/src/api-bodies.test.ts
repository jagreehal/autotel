import { describe, expect, it } from 'vitest';
import { ingestEventRecord } from './index';
import type { AgentRawEvent, AgentSessionStore, Attributes } from './index';

const SESSION = 'sess-bodies';

function event(eventName: string, attributes: Attributes): AgentRawEvent {
  return {
    eventName,
    timestamp: 1000,
    attributes: { 'session.id': SESSION, ...attributes },
    resource: { 'service.name': 'claude-code' },
    scope: { name: 'com.anthropic.claude_code' },
  };
}

/** The shape Claude Code 2.1 exports for a Messages API response. */
const responseBody = JSON.stringify({
  model: 'claude-haiku-4-5',
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: '…' },
    { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} },
  ],
  stop_reason: 'tool_use',
  usage: {
    input_tokens: 2,
    cache_creation_input_tokens: 19_663,
    cache_read_input_tokens: 14_514,
    output_tokens: 155,
    output_tokens_details: { thinking_tokens: 77 },
    service_tier: 'standard',
    cache_creation: {
      ephemeral_1h_input_tokens: 19_663,
      ephemeral_5m_input_tokens: 0,
    },
  },
});

const requestBody = JSON.stringify({
  model: 'claude-haiku-4-5',
  system: [{ type: 'text', text: 'You are a coding agent.' }],
  tools: [{ name: 'Bash' }, { name: 'Read' }],
  messages: [{ role: 'user', content: 'hi' }],
});

const apiRequest = event('claude_code.api_request', {
  model: 'claude-haiku-4-5',
  request_id: 'req_1',
  input_tokens: 2,
  output_tokens: 155,
  cost_usd: 0.03,
});
const requestBodyEvent = event('claude_code.api_request_body', {
  body: requestBody,
  body_length: requestBody.length,
  request_body_id: 'body_1',
});
const responseBodyEvent = event('claude_code.api_response_body', {
  body: responseBody,
  body_length: responseBody.length,
  request_id: 'req_1',
  request_body_id: 'body_1',
});

function ingest(...records: AgentRawEvent[]) {
  const store: AgentSessionStore = new Map();
  for (const record of records) ingestEventRecord(store, record);
  return store.get(SESSION)!;
}

describe('API bodies', () => {
  it('puts both bodies on the api_request they belong to', () => {
    const session = ingest(requestBodyEvent, apiRequest, responseBodyEvent);

    expect(session.timeline.map((e) => e.type)).toEqual(['api_request']);
    expect(session.timeline[0]).toMatchObject({
      stopReason: 'tool_use',
      thinkingTokens: 77,
      cacheWrite1hTokens: 19_663,
      cacheWrite5mTokens: 0,
      toolUses: ['Bash'],
      serviceTier: 'standard',
      requestBytes: requestBody.length,
      request: { systemChars: 23, toolDefinitions: 2, messages: 1 },
    });
  });

  const orders: [string, AgentRawEvent[]][] = [
    [
      'request body, call, response body',
      [requestBodyEvent, apiRequest, responseBodyEvent],
    ],
    [
      'request body, response body, call',
      [requestBodyEvent, responseBodyEvent, apiRequest],
    ],
    [
      'call, request body, response body',
      [apiRequest, requestBodyEvent, responseBodyEvent],
    ],
    [
      'call, response body, request body',
      [apiRequest, responseBodyEvent, requestBodyEvent],
    ],
    [
      'response body, request body, call',
      [responseBodyEvent, requestBodyEvent, apiRequest],
    ],
    [
      'response body, call, request body',
      [responseBodyEvent, apiRequest, requestBodyEvent],
    ],
  ];

  it.each(orders)('joins both bodies when they arrive as %s', (_, records) => {
    const session = ingest(...records);

    expect(session.timeline.map((e) => e.type)).toEqual(['api_request']);
    expect(session.timeline[0]).toMatchObject({
      stopReason: 'tool_use',
      requestBytes: requestBody.length,
      request: { toolDefinitions: 2 },
    });
    expect(session.rollup.pendingRequestBodies).toEqual({});
    expect(session.rollup.pendingResponseBodies).toEqual({});
  });

  describe('without request_body_id (Claude Code before 2.1.3xx)', () => {
    const unkeyedBody = (timestamp: number, bytes: number) => ({
      ...event('claude_code.api_request_body', {
        model: 'claude-haiku-4-5',
        body_length: bytes,
        body_truncated: true,
      }),
      timestamp,
    });
    const call = (timestamp: number, requestId: string) => ({
      ...event('claude_code.api_request', {
        model: 'claude-haiku-4-5',
        request_id: requestId,
      }),
      timestamp,
    });

    // Two calls in sequence: body 100 → call 200, body 300 → call 400.
    const records = new Map([
      [100, unkeyedBody(100, 81_756)],
      [200, call(200, 'req_1')],
      [300, unkeyedBody(300, 82_653)],
      [400, call(400, 'req_2')],
    ]);
    const permutations = (items: number[]): number[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, i) =>
            permutations(items.toSpliced(i, 1)).map((rest) => [item, ...rest]),
          );

    it.each(permutations([100, 200, 300, 400]).map((order) => [order]))(
      'gives each call its own body when they arrive as %j',
      (order) => {
        const session = ingest(...order.map((at) => records.get(at)!));
        const bytes = Object.fromEntries(
          session.timeline.map((e) => [e.timestamp, e.requestBytes]),
        );

        expect(bytes).toEqual({ 200: 81_756, 400: 82_653 });
      },
    );

    it('keeps the sizes of calls whose bodies left the cache', () => {
      // One more call than the 64 bodies kept.
      const sizes = Array.from({ length: 65 }, (_, i) => 1000 + i);
      const session = ingest(
        ...sizes.flatMap((bytes, i) => [
          unkeyedBody(i * 10, bytes),
          call(i * 10 + 5, `req_${i}`),
        ]),
      );

      expect(session.timeline.map((e) => e.requestBytes)).toEqual(sizes);
    });

    it('leaves a call with no body of its own empty', () => {
      const session = ingest(
        records.get(100)!,
        records.get(400)!,
        records.get(200)!,
      );
      const bytes = Object.fromEntries(
        session.timeline.map((e) => [e.timestamp, e.requestBytes]),
      );

      expect(bytes).toEqual({ 200: 81_756, 400: undefined });
    });
  });

  it('totals stop reasons, thinking and cache writes by lifetime', () => {
    const session = ingest(apiRequest, responseBodyEvent, responseBodyEvent);

    expect(session.rollup).toMatchObject({
      stopReasons: { tool_use: 2 },
      thinkingTokens: 154,
      cacheWrite1hTokens: 39_326,
      cacheWrite5mTokens: 0,
      largestRequestBytes: 0,
    });
  });

  it('keeps only the size of a request body cut short', () => {
    const session = ingest(
      event('claude_code.api_request_body', {
        body: requestBody.slice(0, 40),
        body_length: 100_140,
        body_truncated: true,
        request_body_id: 'body_1',
      }),
      apiRequest,
      responseBodyEvent,
    );

    expect(session.rollup.largestRequestBytes).toBe(100_140);
    expect(session.timeline[0]?.requestBytes).toBe(100_140);
    expect(session.timeline[0]?.request).toBeUndefined();
  });

  it('reads nothing from a body that is not JSON', () => {
    const session = ingest(
      apiRequest,
      event('claude_code.api_response_body', {
        body: 'not json',
        request_id: 'req_1',
      }),
    );

    expect(session.rollup.stopReasons).toEqual({});
    expect(session.timeline[0]?.stopReason).toBeUndefined();
  });
});
