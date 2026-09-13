import { describe, expect, it } from 'vitest';

import { createExporter, type OtlpSpan } from './otlp';
import { badge, createRecorder, type Link } from './recorder';

/**
 * The recorder driven with the plain values the hooks read off the engine.
 * `register.ts` is the boundary, type-checked against the vendored
 * declarations; what a span is named, where it sits and what it carries is
 * decided here and checked here.
 */

type Posted = { url: string; body: string };

function link(
  plugin: string,
  outcome: Link['outcome'],
  tier: Link['tier'] = 'user',
  returned: Link['returned'] = {},
): Link {
  return {
    index: 0,
    plugin,
    tier,
    event: 'tool.call',
    outcome,
    ms: 3,
    received: {},
    returned,
  };
}

const DENY = { deny: 'no' };
const OK = { result: 'fine' };

function decidedBy(t: ReturnType<typeof setup>, trace: Link[]) {
  t.recorder.begin({
    event: 'tool.call',
    origin: engine,
    tool: { name: 'Bash', useId: 'tu-x' },
  })({ trace, denied: true });
  const [call] = t.flushed();
  return t.attr(call, 'claude_code.decided_by');
}

const engine = { plugin: 'engine', tier: 'core' } as const;

function setup() {
  const posts: Posted[] = [];
  const timers: Array<() => void> = [];
  const exporter = createExporter({
    fetch: async (url, init) => {
      posts.push({ url, body: init.body ?? '' });
      return { status: 200, ok: true, headers: {}, text: '' };
    },
    after: (_ms, fn) => {
      timers.push(fn);
      return { cancel: () => {} };
    },
    endpoint: 'http://devtools:4318',
    headers: {},
    resource: { 'service.name': 'claude-code' },
  });
  const recorder = createRecorder(exporter);
  const flushed = (): OtlpSpan[] => {
    for (const fire of timers.splice(0)) fire();
    return posts.flatMap((post) => {
      const payload: {
        resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
      } = JSON.parse(post.body);
      return payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    });
  };
  const attr = (span: OtlpSpan | undefined, key: string) =>
    span?.attributes.find((a) => a.key === key)?.value;
  return { recorder, posts, flushed, attr };
}

describe('recorder', () => {
  it('records a turn as one trace: dispatches under a root, the chain as events', () => {
    const t = setup();

    t.recorder.begin({
      event: 'prompt.submit',
      origin: engine,
      opensTurn: true,
    })({ trace: [] });
    t.recorder.begin({
      event: 'turn.start',
      origin: engine,
      opensTurn: true,
      turnId: 'turn-1',
    })({ trace: [] });
    t.recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Bash', useId: 'tu-1', agentId: 'agent-1' },
    })({
      trace: [
        link('guard', 'returned', 'prepend', DENY),
        link('engine', 'skipped', 'core', undefined),
      ],
      denied: true,
    });
    t.recorder.begin({ event: 'turn.complete', origin: engine })({
      trace: [],
      turnComplete: {
        turnId: 'turn-1',
        reason: 'answer',
        isAborted: false,
        durationMs: 900,
      },
    });

    // The turn's end posts at once rather than waiting for the batch timer.
    expect(t.posts).toHaveLength(1);
    const spans = t.flushed();
    expect(t.posts[0]?.url).toBe('http://devtools:4318/v1/traces');
    const root = spans.find((s) => s.name === 'claude_code.turn');
    const submit = spans.find((s) => s.name === 'claude_code.prompt.submit');
    expect(submit?.parentSpanId).toBe(root?.spanId);
    expect(t.attr(root, 'claude_code.turn.id')).toEqual({
      stringValue: 'turn-1',
    });
    const call = spans.find((s) => s.name === 'claude_code.tool.call');
    const complete = spans.find((s) => s.name === 'claude_code.turn.complete');
    expect(root?.parentSpanId).toBeUndefined();
    expect(call?.traceId).toBe(root?.traceId);
    expect(call?.parentSpanId).toBe(root?.spanId);
    expect(complete?.parentSpanId).toBe(root?.spanId);
    expect(t.attr(call, 'tool_name')).toEqual({ stringValue: 'Bash' });
    expect(t.attr(call, 'agent_id')).toEqual({ stringValue: 'agent-1' });
    expect(t.attr(call, 'claude_code.decided_by')).toEqual({
      stringValue: 'guard',
    });
    expect(call?.events.map((e) => e.name)).toEqual(['hook', 'hook']);
    expect(call?.events[0]?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'plugin.name', value: { stringValue: 'guard' } },
        { key: 'claude_code.hook.tier', value: { stringValue: 'prepend' } },
        { key: 'claude_code.hook.outcome', value: { stringValue: 'returned' } },
        { key: 'duration_ms', value: { intValue: '3' } },
      ]),
    );
    expect(t.attr(root, 'duration_ms')).toEqual({ intValue: '900' });
    expect(root?.status).toEqual({ code: 1 });
  });

  it('outside a turn every dispatch is a trace of its own, and a throw marks it failed', () => {
    const t = setup();
    t.recorder.begin({ event: 'session.start', origin: engine })({
      trace: [],
      error: 'boom',
    });
    t.recorder.begin({
      event: 'fs.read',
      origin: { plugin: 'diff', tier: 'builtin' },
    })({ trace: [] });

    const [first, second] = t.flushed();
    expect(first?.traceId).not.toBe(second?.traceId);
    expect(first?.parentSpanId).toBeUndefined();
    expect(first?.status).toEqual({ code: 2, message: 'boom' });
    expect(t.attr(second, 'plugin.name')).toEqual({ stringValue: 'diff' });
  });

  it('keeps each tool call settled timing for its row, naming a denial', () => {
    const t = setup();
    expect(t.recorder.timingFor('tu-2')).toBeUndefined();
    t.recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Bash', useId: 'tu-2' },
    })({
      trace: [link('guard', 'returned')],
      denied: true,
    });
    t.recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Read', useId: 'tu-3' },
    })({
      trace: [link('logger', 'passed'), link('engine', 'returned', 'core')],
    });
    expect(t.recorder.timingFor('tu-2')).toMatchObject({ denied: true });
    expect(t.recorder.timingFor('tu-3')).toMatchObject({ denied: false });
    expect(badge({ ms: 12, denied: true })).toBe(' denied by hook · 12ms');
    expect(badge({ ms: 1510, denied: false })).toBe(' 1.51s');
  });

  it('$.autotel.span exports a span in the current turn and rethrows its failure', async () => {
    const t = setup();
    t.recorder.begin({ event: 'turn.start', origin: engine, opensTurn: true })({
      trace: [],
    });

    const answer = await t.recorder.autotel.span(
      'summarise',
      async (span) => {
        span.setAttribute('gen_ai.request.model', 'claude-opus-5');
        span.addEvent('chunk', { index: 0 });
        return 42;
      },
      { 'plugin.feature': 'summary' },
    );
    expect(answer).toBe(42);
    await expect(
      t.recorder.autotel.span('fails', () => Promise.reject(new Error('nope'))),
    ).rejects.toThrow('nope');

    const spans = t.flushed();
    const root = spans.find((s) => s.name === 'claude_code.turn');
    const own = spans.find((s) => s.name === 'summarise');
    const failed = spans.find((s) => s.name === 'fails');
    expect(root).toBeUndefined(); // still open: the turn has not completed
    expect(own?.parentSpanId).toBeDefined();
    expect(t.attr(own, 'gen_ai.request.model')).toEqual({
      stringValue: 'claude-opus-5',
    });
    expect(t.attr(own, 'plugin.feature')).toEqual({ stringValue: 'summary' });
    expect(own?.events[0]).toMatchObject({ name: 'chunk' });
    expect(failed?.status).toEqual({ code: 2, message: 'Error: nope' });
  });

  it('is inert without an exporter: $.autotel.span still runs its body', async () => {
    const recorder = createRecorder(undefined);
    recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Bash', useId: 'x' },
    })({ trace: [] });
    expect(recorder.timingFor('x')).toBeUndefined();
    expect(
      await recorder.autotel.span(
        'x',
        (span) => (span.setAttribute('k', 1), 'ran'),
      ),
    ).toBe('ran');
  });

  it('a subagent turn.complete leaves the main turn open; the matching one closes it', () => {
    const t = setup();
    t.recorder.begin({
      event: 'turn.start',
      origin: engine,
      opensTurn: true,
      turnId: 'main',
    })({ trace: [] });
    t.recorder.begin({ event: 'turn.complete', origin: engine })({
      trace: [],
      turnComplete: {
        turnId: 'sub',
        agentId: 'agent-1',
        reason: 'answer',
        isAborted: false,
        durationMs: 50,
      },
    });
    t.recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Read', useId: 'tu-9' },
    })({ trace: [] });
    t.recorder.begin({ event: 'turn.complete', origin: engine })({
      trace: [],
      turnComplete: {
        turnId: 'main',
        reason: 'answer',
        isAborted: false,
        durationMs: 900,
      },
    });

    const spans = t.flushed();
    const root = spans.find((s) => s.name === 'claude_code.turn');
    const call = spans.find((s) => s.name === 'claude_code.tool.call');
    expect(spans.filter((s) => s.name === 'claude_code.turn')).toHaveLength(1);
    expect(call?.parentSpanId).toBe(root?.spanId);
    expect(t.attr(root, 'duration_ms')).toEqual({ intValue: '900' });
  });

  it('a denial is the result, not a link that merely copied one through', () => {
    const t = setup();
    t.recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Bash', useId: 'ok' },
    })({
      trace: [link('logger', 'returned'), link('engine', 'returned', 'core')],
    });
    t.recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Bash', useId: 'no' },
    })({ trace: [link('guard', 'returned')], denied: true });
    expect(t.recorder.timingFor('ok')).toMatchObject({ denied: false });
    expect(t.recorder.timingFor('no')).toMatchObject({ denied: true });
    const spans = t.flushed();
    const ok = spans.find(
      (s) =>
        t.attr(s, 'tool_use_id')?.toString() !== undefined &&
        s.attributes.some(
          (a) =>
            a.key === 'tool_use_id' &&
            'stringValue' in a.value &&
            a.value.stringValue === 'ok',
        ),
    );
    expect(t.attr(ok, 'claude_code.decided_by')).toBeUndefined();
  });

  it('a dropped prompt settles its provisional root; the next prompt opens a fresh turn', () => {
    const t = setup();
    t.recorder.begin({
      event: 'prompt.submit',
      origin: engine,
      opensTurn: true,
    })({
      trace: [],
      promptDropped: 'blocked by policy',
    });
    t.recorder.begin({
      event: 'prompt.submit',
      origin: engine,
      opensTurn: true,
    })({
      trace: [],
    });
    t.recorder.begin({ event: 'turn.complete', origin: engine })({
      trace: [],
      turnComplete: {
        turnId: 't2',
        reason: 'answer',
        isAborted: false,
        durationMs: 10,
      },
    });

    const roots = t.flushed().filter((s) => s.name === 'claude_code.turn');
    expect(roots).toHaveLength(2);
    expect(t.attr(roots[0], 'claude_code.prompt.dropped')).toEqual({
      stringValue: 'blocked by policy',
    });
    expect(roots[0]?.traceId).not.toBe(roots[1]?.traceId);
  });

  it('attributes a denial by following the final one through forwarding links', () => {
    // a logger passing the guard's denial up: the guard's
    expect(
      decidedBy(setup(), [
        link('logger', 'returned', 'user', DENY),
        link('guard', 'returned', 'append', DENY),
        link('bypassed', 'skipped', 'builtin', undefined),
      ]),
    ).toEqual({ stringValue: 'guard' });
    // a skipped hook between forwarder and guard is not a changed result
    expect(
      decidedBy(setup(), [
        link('forwarder', 'returned', 'user', DENY),
        link('bypassed', 'skipped', 'builtin', undefined),
        link('guard', 'returned', 'append', DENY),
      ]),
    ).toEqual({ stringValue: 'guard' });
    // skipped entries above the first real result are ignored too
    expect(
      decidedBy(setup(), [
        link('bypassed', 'skipped', 'builtin', undefined),
        link('forwarder', 'returned', 'user', DENY),
        link('guard', 'returned', 'append', DENY),
      ]),
    ).toEqual({ stringValue: 'guard' });
    // an outer hook replacing a success beneath it: the outer's
    expect(
      decidedBy(setup(), [
        link('outer', 'returned', 'user', DENY),
        link('inner', 'returned', 'user', OK),
        link('engine', 'returned', 'core', OK),
      ]),
    ).toEqual({ stringValue: 'outer' });
    // an outer hook turning a rejection beneath it into a denial: the outer's
    expect(
      decidedBy(setup(), [
        link('outer', 'returned', 'user', DENY),
        link('inner', 'rejected', 'user', undefined),
      ]),
    ).toEqual({ stringValue: 'outer' });
    // an overridden inner denial must not win over the outer final denial
    expect(
      decidedBy(setup(), [
        link('outer-policy', 'returned', 'user', DENY),
        link('fallback', 'returned', 'user', OK),
        link('inner-policy', 'returned', 'user', DENY),
      ]),
    ).toEqual({ stringValue: 'outer-policy' });
    // top of the chain does not show the denial: no name rather than a guess
    expect(
      decidedBy(setup(), [
        link('logger', 'returned', 'user', OK),
        link('engine', 'returned', 'core', OK),
      ]),
    ).toBeUndefined();
    // a deeper denial with a different result above it is ambiguous: omit
    expect(
      decidedBy(setup(), [
        link('fallback', 'returned', 'user', OK),
        link('inner-policy', 'returned', 'user', DENY),
      ]),
    ).toBeUndefined();
  });

  it('a prompt dropped mid-turn closes nothing: the running turn keeps its root', () => {
    const t = setup();
    t.recorder.begin({
      event: 'turn.start',
      origin: engine,
      opensTurn: true,
      turnId: 'main',
    })({ trace: [] });
    t.recorder.begin({
      event: 'prompt.submit',
      origin: engine,
      opensTurn: true,
    })({
      trace: [],
      promptDropped: 'queued prompt refused',
    });
    t.recorder.begin({
      event: 'tool.call',
      origin: engine,
      tool: { name: 'Read', useId: 'tu-m' },
    })({ trace: [] });
    t.recorder.begin({ event: 'turn.complete', origin: engine })({
      trace: [],
      turnComplete: {
        turnId: 'main',
        reason: 'answer',
        isAborted: false,
        durationMs: 42,
      },
    });

    const spans = t.flushed();
    const roots = spans.filter((s) => s.name === 'claude_code.turn');
    const call = spans.find((s) => s.name === 'claude_code.tool.call');
    expect(roots).toHaveLength(1);
    expect(t.attr(roots[0], 'claude_code.prompt.dropped')).toBeUndefined();
    expect(t.attr(roots[0], 'duration_ms')).toEqual({ intValue: '42' });
    expect(call?.parentSpanId).toBe(roots[0]?.spanId);
  });
});
