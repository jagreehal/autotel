import { describe, expect, it } from 'vitest';
import {
  contextTokens,
  ingestEventRecord,
  postCompactionRegression,
} from './index';
import type {
  AgentEvent,
  AgentRawEvent,
  AgentSession,
  AgentSessionStore,
} from './index';

const SESSION = 'sess-compaction';

/** One `api_request` with the token shape Claude Code emits. */
function request(
  seq: number,
  tokens: { input: number; cacheRead: number; cacheCreation: number },
): AgentRawEvent {
  return {
    eventName: 'api_request',
    timestamp: 1000 + seq * 1000,
    attributes: {
      'session.id': SESSION,
      'event.sequence': seq,
      model: 'claude-opus-4-8',
      input_tokens: tokens.input,
      output_tokens: 50,
      cache_read_tokens: tokens.cacheRead,
      cache_creation_tokens: tokens.cacheCreation,
    },
    resource: { 'service.name': 'claude-code' },
    scope: { name: 'com.anthropic.claude_code' },
  };
}

/** A conversation turn: the prefix is cached, `grown` new tokens are added. */
function turn(seq: number, context: number, grown = 200): AgentRawEvent {
  return request(seq, {
    input: 2,
    cacheRead: context - grown - 2,
    cacheCreation: grown,
  });
}

function fold(events: AgentRawEvent[]): AgentSession {
  const store: AgentSessionStore = new Map();
  for (const e of events) ingestEventRecord(store, e);
  const session = store.get(SESSION);
  if (!session) throw new Error('no session');
  return session;
}

/** An `api_request` attributed to a named query source (main, subagent, sdk). */
function from(seq: number, context: number, source: string): AgentRawEvent {
  const base = turn(seq, context);
  return { ...base, attributes: { ...base.attributes, query_source: source } };
}

/** A normalised tool call, for the post-compaction behaviour comparison. */
function tool(
  timestamp: number,
  name: string,
  category: 'file' | 'shell',
): AgentEvent {
  return {
    id: `e-${timestamp}`,
    sessionId: SESSION,
    agent: 'claude-code',
    type: 'tool_result',
    rawEventName: 'tool_result',
    timestamp,
    tool: { name, category, isMcp: false },
    attributes: {},
  } as AgentEvent;
}

describe('contextTokens', () => {
  it('is the whole prompt: fresh input plus cached prefix plus new cache', () => {
    // Matches the recorded fixture: a first request caches its whole prefix,
    // the next reads that prefix back and caches only what it added.
    expect(
      contextTokens({
        inputTokens: 2,
        cacheReadTokens: 29_490,
        cacheCreationTokens: 130,
      }),
    ).toBe(29_622);
  });

  it('is zero for an event carrying no token counts', () => {
    expect(contextTokens({})).toBe(0);
  });
});

describe('context reset detection', () => {
  it('tracks the high-water mark of a growing conversation', () => {
    const session = fold([turn(1, 20_000), turn(2, 40_000), turn(3, 60_000)]);

    expect(session.rollup.contextHighWaterTokens).toBe(60_000);
    expect(session.rollup.compactions).toEqual([]);
  });

  it('flags a large sustained drop as a compaction', () => {
    // 120k of context becomes a 15k summary and the conversation carries on
    // from there. Everything before that point left the agent's head.
    const session = fold([
      turn(1, 60_000),
      turn(2, 120_000),
      request(3, { input: 2, cacheRead: 0, cacheCreation: 15_000 }),
      turn(4, 18_000),
    ]);

    expect(session.rollup.compactions).toHaveLength(1);
    const [reset] = session.rollup.compactions;
    expect(reset?.contextBefore).toBe(120_000);
    expect(reset?.contextAfter).toBe(15_002);
    expect(reset?.droppedTokens).toBe(104_998);
    expect(session.rollup.contextHighWaterTokens).toBe(18_000);
  });

  it('does not flag a sub-agent excursion that returns to the old context', () => {
    // A Task sub-agent runs on a fresh context, so its requests are small and
    // interleaved. The parent then resumes at its old size — the dip was never
    // a reset, and pairwise comparison would call every sub-agent a compaction.
    const session = fold([turn(1, 120_000), turn(2, 8000), turn(3, 122_000)]);

    expect(session.rollup.compactions).toEqual([]);
    expect(session.rollup.contextHighWaterTokens).toBe(122_000);
  });

  it('ignores drops in a conversation too small to have been compacted', () => {
    // Below the floor a drop is just a short session or an unrelated request.
    const session = fold([turn(1, 8000), turn(2, 1000)]);

    expect(session.rollup.compactions).toEqual([]);
  });

  it('ignores a shallow drop that leaves most of the context in place', () => {
    const session = fold([turn(1, 100_000), turn(2, 85_000)]);

    expect(session.rollup.compactions).toEqual([]);
  });

  it('rates a drop that wrote a summary as likelier than one that did not', () => {
    const withSummary = fold([
      turn(1, 120_000),
      request(3, { input: 2, cacheRead: 0, cacheCreation: 15_000 }),
    ]);
    const withoutSummary = fold([
      turn(1, 120_000),
      request(3, { input: 12_000, cacheRead: 0, cacheCreation: 0 }),
    ]);

    expect(withSummary.rollup.compactions[0]?.confidence).toBe('likely');
    expect(withoutSummary.rollup.compactions[0]?.confidence).toBe('possible');
  });

  it('keeps a compaction that the session later regrew past', () => {
    // Regrowth after a compaction is gradual — turn by turn back up to and
    // beyond the old size. Withdrawing the reset the moment it crosses the old
    // high-water erases the one fact the session most needs to carry.
    const session = fold([
      turn(1, 120_000),
      request(2, { input: 2, cacheRead: 0, cacheCreation: 15_000 }),
      turn(3, 60_000),
      turn(4, 119_000),
      turn(5, 125_000),
    ]);

    expect(session.rollup.compactions).toHaveLength(1);
    expect(session.rollup.compactions[0]?.contextBefore).toBe(120_000);
    expect(session.rollup.contextHighWaterTokens).toBe(125_000);
  });

  it('records each compaction when a long session is compacted twice', () => {
    const session = fold([
      turn(1, 120_000),
      request(2, { input: 2, cacheRead: 0, cacheCreation: 15_000 }),
      turn(3, 110_000),
      request(4, { input: 2, cacheRead: 0, cacheCreation: 14_000 }),
      turn(5, 20_000),
    ]);

    expect(session.rollup.compactions).toHaveLength(2);
    expect(session.rollup.compactions.map((c) => c.contextBefore)).toEqual([
      120_000, 110_000,
    ]);
  });

  it('anchors each compaction to the event and time it was detected at', () => {
    const session = fold([
      turn(1, 120_000),
      request(2, { input: 2, cacheRead: 0, cacheCreation: 15_000 }),
    ]);

    const [reset] = session.rollup.compactions;
    expect(reset?.atEventId).toBe(`${SESSION}:2`);
    expect(reset?.timestamp).toBe(3000);
  });
});

describe('context reset detection — provenance and lineage', () => {
  it('ignores requests whose token counts were estimated', () => {
    // A compaction inferred from an estimated prompt size is a guess about a
    // guess. An estimate must not seed the baseline either — a wrong high-water
    // makes every later comparison wrong.
    const estimated = (seq: number, context: number): AgentRawEvent => ({
      ...turn(seq, context),
      attributes: {
        ...turn(seq, context).attributes,
        token_source: 'estimated',
      },
    });

    const session = fold([
      estimated(1, 120_000),
      estimated(2, 15_000),
      turn(3, 20_000),
    ]);

    expect(session.rollup.compactions).toEqual([]);
    expect(session.rollup.contextHighWaterTokens).toBe(20_000);
  });

  it('keeps separate query sources on separate context baselines', () => {
    // `query_source` distinguishes where a request came from. Two sources are
    // two independent conversations, and comparing their prompt sizes reads a
    // small one as a compaction of the large one — structurally, before any
    // heuristic gets a say.
    const session = fold([
      from(1, 120_000, 'main'),
      from(2, 8000, 'subagent'),
      from(3, 122_000, 'main'),
    ]);

    expect(session.rollup.compactions).toEqual([]);
  });

  it('still detects a compaction inside one query source', () => {
    const session = fold([
      from(1, 120_000, 'main'),
      from(2, 9000, 'subagent'),
      from(3, 15_000, 'main'),
    ]);

    expect(session.rollup.compactions).toHaveLength(1);
    const [reset] = session.rollup.compactions;
    expect(reset?.contextBefore).toBe(120_000);
    // The drop that matters is main's 120k → 15k, not the sub-agent's 9k
    // passing through. Anchoring on the sub-agent request blames the wrong
    // event and reports a loss that never happened to this conversation.
    expect(reset?.contextAfter).toBe(15_000);
    expect(reset?.lineageId).toBe('main');
  });
});

describe('detectContextResets threshold', () => {
  it('does not fire on a drop shallower than the configured threshold', () => {
    // Default keeps at most half the context. A 55% retention is a shrinking
    // conversation, not a replaced one.
    const session = fold([turn(1, 120_000), turn(2, 66_000)]);
    expect(session.rollup.compactions).toEqual([]);
  });

  it('fires once the drop passes the threshold', () => {
    const session = fold([turn(1, 120_000), turn(2, 40_000)]);
    expect(session.rollup.compactions).toHaveLength(1);
  });
});

describe('postCompactionRegression', () => {
  const reset = {
    atEventId: 'x',
    timestamp: 1000,
    contextBefore: 120_000,
    contextAfter: 15_000,
    droppedTokens: 105_000,
    confidence: 'likely' as const,
  };

  it('flags the agent re-reading files it had already read', () => {
    // Rebuilding a lost context looks like re-exploration: the same files, read
    // again, because the record of having read them went with the summary.
    const timeline: AgentEvent[] = [
      tool(100, 'Read', 'file'),
      tool(200, 'Edit', 'file'),
      tool(300, 'Bash', 'shell'),
      tool(1100, 'Read', 'file'),
      tool(1200, 'Read', 'file'),
      tool(1300, 'Read', 'file'),
    ];

    const result = postCompactionRegression(timeline, reset);
    expect(result.regressed).toBe(true);
    expect(result.readShareAfter).toBeGreaterThan(result.readShareBefore);
  });

  it('does not treat edits and writes as re-reading', () => {
    // Read, Edit and Write all share the `file` category. Counting the category
    // makes a burst of editing — the agent working — read as re-exploration.
    const timeline: AgentEvent[] = [
      tool(100, 'Read', 'file'),
      tool(200, 'Bash', 'shell'),
      tool(300, 'Bash', 'shell'),
      tool(1100, 'Edit', 'file'),
      tool(1200, 'Write', 'file'),
      tool(1300, 'Edit', 'file'),
    ];

    expect(postCompactionRegression(timeline, reset).regressed).toBe(false);
  });

  it('does not flag a session that carried straight on working', () => {
    const timeline: AgentEvent[] = [
      tool(100, 'Read', 'file'),
      tool(200, 'Edit', 'file'),
      tool(300, 'Bash', 'shell'),
      tool(1100, 'Edit', 'file'),
      tool(1200, 'Bash', 'shell'),
      tool(1300, 'Edit', 'file'),
    ];

    expect(postCompactionRegression(timeline, reset).regressed).toBe(false);
  });

  it('reports unknown rather than a verdict when a side has no calls left', () => {
    // The timeline is ring-buffered. Once the pre-compaction half has rolled
    // out of the window there is nothing to compare against, and answering
    // anyway would be inventing a baseline.
    const timeline: AgentEvent[] = [tool(1100, 'Read', 'file')];

    const result = postCompactionRegression(timeline, reset);
    expect(result.regressed).toBeUndefined();
    expect(result.reason).toMatch(/no calls/i);
  });
});
