import { describe, expect, it, vi } from 'vitest';
import {
  CONTEXT_LIMITS,
  contextBudget,
  costCeiling,
  createGenAiBudget,
  createGenAiGuard,
  errorLoop,
  maxDuration,
  maxSteps,
  maxToolCalls,
  parseGuardRules,
  spinLoop,
  tokenCeiling,
} from './guard.js';

describe('costCeiling', () => {
  it('stops once accumulated cost exceeds the limit', () => {
    const guard = createGenAiGuard({
      rules: [costCeiling(1)],
      onStop: 'abort',
    });
    expect(guard.record({ usage: { costUsd: 0.6 } })).toEqual([]);
    const fired = guard.record({ usage: { costUsd: 0.6 } });
    expect(fired).toHaveLength(1);
    expect(fired[0].rule).toBe('cost-ceiling:$1');
    expect(fired[0].action).toBe('stop');
    expect(guard.stopped).toBe(true);
    expect(guard.signal.aborted).toBe(true);
  });

  it('fires only once even if cost keeps climbing', () => {
    const guard = createGenAiGuard({ rules: [costCeiling(1)], onStop: 'abort' });
    guard.record({ usage: { costUsd: 2 } });
    expect(guard.record({ usage: { costUsd: 2 } })).toEqual([]);
    expect(guard.violations).toHaveLength(1);
  });
});

describe('tokenCeiling', () => {
  it('sums input + output tokens', () => {
    const guard = createGenAiGuard({ rules: [tokenCeiling(100)], onStop: 'abort' });
    const fired = guard.record({ usage: { inputTokens: 60, outputTokens: 60 } });
    expect(fired[0].observed).toBe(120);
    expect(fired[0].limit).toBe(100);
  });
});

describe('maxToolCalls', () => {
  it('counts only tool-kind steps', () => {
    const guard = createGenAiGuard({ rules: [maxToolCalls(2)], onStop: 'abort' });
    guard.record({ kind: 'llm' });
    guard.record({ kind: 'tool' });
    guard.record({ kind: 'tool' });
    expect(guard.stopped).toBe(false);
    const fired = guard.record({ kind: 'tool' });
    expect(fired).toHaveLength(1);
    expect(guard.state.toolCallCount).toBe(3);
  });
});

describe('maxSteps', () => {
  it('counts every recorded step', () => {
    const guard = createGenAiGuard({ rules: [maxSteps(2)], onStop: 'abort' });
    guard.record({ kind: 'llm' });
    guard.record({ kind: 'tool' });
    expect(guard.record({ kind: 'llm' })).toHaveLength(1);
  });
});

describe('maxDuration', () => {
  it('fires when wall-clock elapsed exceeds the limit', () => {
    let clock = 1000;
    const guard = createGenAiGuard({
      rules: [maxDuration(500)],
      onStop: 'abort',
      now: () => clock,
    });
    guard.record({ kind: 'llm' });
    expect(guard.stopped).toBe(false);
    clock = 1600; // 600ms elapsed
    const fired = guard.check();
    expect(fired).toHaveLength(1);
    expect(fired[0].rule).toBe('max-duration:500ms');
  });
});

describe('spinLoop', () => {
  it('fires when the same step repeats within the window', () => {
    const guard = createGenAiGuard({
      rules: [spinLoop({ count: 3, window: 5 })],
      onStop: 'abort',
    });
    const call = { kind: 'tool' as const, name: 'search', signature: '{"q":"x"}' };
    expect(guard.record(call)).toEqual([]);
    expect(guard.record(call)).toEqual([]);
    const fired = guard.record(call);
    expect(fired).toHaveLength(1);
    expect(fired[0].observed).toBe(3);
  });

  it('does not fire for distinct signatures', () => {
    const guard = createGenAiGuard({
      rules: [spinLoop({ count: 2, window: 5 })],
      onStop: 'abort',
    });
    guard.record({ kind: 'tool', name: 'search', signature: 'a' });
    guard.record({ kind: 'tool', name: 'search', signature: 'b' });
    expect(guard.stopped).toBe(false);
  });

  it('ignores steps without a name', () => {
    const guard = createGenAiGuard({
      rules: [spinLoop({ count: 2, window: 5 })],
      onStop: 'abort',
    });
    guard.record({ kind: 'llm' });
    guard.record({ kind: 'llm' });
    expect(guard.stopped).toBe(false);
  });
});

describe('errorLoop', () => {
  it('fires on consecutive errors and resets on success', () => {
    const guard = createGenAiGuard({
      rules: [errorLoop({ count: 3 })],
      onStop: 'abort',
    });
    guard.record({ kind: 'tool', error: true });
    guard.record({ kind: 'tool', error: false }); // breaks the streak
    guard.record({ kind: 'tool', error: true });
    guard.record({ kind: 'tool', error: true });
    expect(guard.stopped).toBe(false);
    const fired = guard.record({ kind: 'tool', error: true });
    expect(fired).toHaveLength(1);
    expect(fired[0].observed).toBe(3);
  });
});

describe('contextBudget', () => {
  it('resolves a model context window and fires at the threshold', () => {
    const guard = createGenAiGuard({
      rules: [contextBudget({ model: 'gpt-4o', threshold: 0.9 })],
      onStop: 'abort',
    });
    // gpt-4o = 128k; 90% = 115_200
    guard.record({ usage: { inputTokens: 115_000 } });
    expect(guard.stopped).toBe(false);
    const fired = guard.record({ usage: { inputTokens: 500 } });
    expect(fired).toHaveLength(1);
  });

  it('accepts an explicit limit', () => {
    const guard = createGenAiGuard({
      rules: [contextBudget({ limit: 1000, threshold: 0.5 })],
      onStop: 'abort',
    });
    expect(guard.record({ usage: { inputTokens: 600 } })).toHaveLength(1);
  });

  it('exposes a context-limit table', () => {
    expect(CONTEXT_LIMITS['gpt-4o']).toBe(128_000);
  });
});

describe('onStop behaviour', () => {
  it('throws a structured GEN_AI_GUARD_STOP error by default', () => {
    const guard = createGenAiGuard({ rules: [costCeiling(1)] });
    expect(() => guard.record({ usage: { costUsd: 2 } })).toThrowError(
      /halted the run/,
    );
    expect(guard.stopped).toBe(true);
    expect(guard.signal.aborted).toBe(true);
  });

  it('aborts without throwing when onStop is "abort"', () => {
    const guard = createGenAiGuard({ rules: [costCeiling(1)], onStop: 'abort' });
    expect(() => guard.record({ usage: { costUsd: 2 } })).not.toThrow();
    expect(guard.signal.aborted).toBe(true);
  });

  it('neither aborts nor throws when onStop is "silent"', () => {
    const guard = createGenAiGuard({ rules: [costCeiling(1)], onStop: 'silent' });
    const fired = guard.record({ usage: { costUsd: 2 } });
    expect(fired).toHaveLength(1);
    expect(guard.stopped).toBe(true);
    expect(guard.signal.aborted).toBe(false);
  });

  it('lets a warn rule pass without stopping', () => {
    const guard = createGenAiGuard({ rules: [costCeiling(1, 'warn')] });
    const fired = guard.record({ usage: { costUsd: 2 } });
    expect(fired[0].action).toBe('warn');
    expect(guard.stopped).toBe(false);
  });
});

describe('telemetry sink', () => {
  it('records session attributes and a stop event', () => {
    const setAttributes = vi.fn();
    const track = vi.fn();
    const guard = createGenAiGuard({ rules: [costCeiling(1)], onStop: 'abort' });
    guard.record({ kind: 'tool', usage: { costUsd: 2, inputTokens: 10 } }, {
      setAttributes,
      track,
    });
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.session.cost.usd': 2,
        'gen_ai.session.tool_call.count': 1,
      }),
    );
    expect(setAttributes).toHaveBeenCalledWith({ 'gen_ai.guard.stopped': true });
    expect(track).toHaveBeenCalledWith(
      'gen_ai.guard.stop',
      expect.objectContaining({ 'gen_ai.guard.rule': 'cost-ceiling:$1' }),
    );
  });
});

describe('parseGuardRules', () => {
  it('parses a full shorthand string', () => {
    const rules = parseGuardRules(
      'budget:$5,tokens:100k,loop:3/10,errors:3,max-tools:50,max-steps:100,timeout:30m,context:0.9@gpt-4o',
    );
    expect(rules.map((r) => r.name)).toEqual([
      'cost-ceiling:$5',
      'token-ceiling:100000',
      'spin-loop:3/10',
      'error-loop:3',
      'max-tool-calls:50',
      'max-steps:100',
      'max-duration:1800000ms',
      'context-budget:90%',
    ]);
  });

  it('defaults all rules to stop, overridable to warn', () => {
    expect(parseGuardRules('budget:$5')[0].action).toBe('stop');
    expect(
      parseGuardRules('budget:$5', { defaultAction: 'warn' })[0].action,
    ).toBe('warn');
  });

  it('throws on an unknown rule key', () => {
    expect(() => parseGuardRules('bogus:1')).toThrow(/unknown guard rule/);
  });
});

describe('createGenAiBudget', () => {
  it('wires warn + stop cost thresholds', () => {
    const events: string[] = [];
    const guard = createGenAiBudget({
      maxCostUsd: 5,
      warnAtUsd: 4,
      onStop: 'abort',
    });
    let fired = guard.record({ usage: { costUsd: 4.5 } });
    events.push(...fired.map((v) => v.action));
    expect(fired[0].action).toBe('warn');
    expect(guard.stopped).toBe(false);

    fired = guard.record({ usage: { costUsd: 1 } });
    expect(fired[0].action).toBe('stop');
    expect(guard.stopped).toBe(true);
  });

  it('enforces a tool-call ceiling', () => {
    const guard = createGenAiBudget({ maxToolCalls: 1, onStop: 'abort' });
    guard.record({ kind: 'tool' });
    expect(guard.record({ kind: 'tool' })).toHaveLength(1);
  });
});
