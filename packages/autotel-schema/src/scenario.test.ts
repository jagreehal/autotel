import { describe, expect, it } from 'vitest';

import { defineContract } from './contract.js';
import {
  checkScenario,
  evaluateScenario,
  formatScenarioResult,
  isScenarioClosed,
  parseCardinality,
  proposeScenario,
  validateScenarioSpec,
  type ScenarioSpan,
  type ScenarioSpec,
} from './scenario.js';

/** Terse span builder — happy-path transfer flow by default. */
function span(
  name: string,
  overrides: Partial<ScenarioSpan> = {},
): ScenarioSpan {
  return { spanId: `id-${name}-${overrides.spanId ?? '0'}`, name, status: 'ok', ...overrides };
}

const transferAccept: ScenarioSpec = {
  completion: {
    mode: 'terminal-event',
    event: 'transfer.queued',
    observationBudgetMs: 500,
  },
  events: {
    'transfer.request': { cardinality: 'exactly 1' },
    'transfer.validate': { cardinality: 'exactly 1' },
    'transfer.queued': { cardinality: 'exactly 1' },
    'transfer.retry': { cardinality: 'at most 3' },
  },
  edges: [
    ['transfer.request', 'transfer.validate'],
    ['transfer.request', 'transfer.queued'],
  ],
};

/** A conformant run: request → validate + queued as children. */
function happyPath(): ScenarioSpan[] {
  return [
    span('transfer.request', { spanId: 'root' }),
    span('transfer.validate', { spanId: 'v1', parentSpanId: 'root' }),
    span('transfer.queued', { spanId: 'q1', parentSpanId: 'root' }),
  ];
}

describe('parseCardinality', () => {
  it('parses the shorthands', () => {
    expect(parseCardinality('exactly 2')).toEqual({ min: 2, max: 2 });
    expect(parseCardinality('at least 1')).toEqual({ min: 1 });
    expect(parseCardinality('at most 3')).toEqual({ min: 0, max: 3 });
    expect(parseCardinality('0..1')).toEqual({ min: 0, max: 1 });
    expect(parseCardinality('2..')).toEqual({ min: 2, max: undefined });
  });

  it('passes canonical ranges through and validates them', () => {
    expect(parseCardinality({ min: 1, max: 4 })).toEqual({ min: 1, max: 4 });
    expect(() => parseCardinality({ min: 3, max: 1 })).toThrowError(/max/);
    expect(() => parseCardinality({ min: -1 })).toThrowError(/min/);
  });

  it('rejects gibberish', () => {
    expect(() => parseCardinality('a few')).toThrowError(/unparseable/);
    expect(() => parseCardinality('3..1')).toThrowError(/max < min/);
  });
});

describe('validateScenarioSpec / defineContract integration', () => {
  it('accepts a valid scenario inside defineContract', () => {
    const contract = defineContract({
      service: 'transfer',
      version: '1.0.0',
      spans: {},
      scenarios: { 'transfer.accept': transferAccept },
    });
    expect(contract.scenarios?.['transfer.accept']).toBeDefined();
  });

  it('rejects a scenario with no events', () => {
    expect(() =>
      validateScenarioSpec('empty', {
        completion: { mode: 'root-span-closed', observationBudgetMs: 100 },
        events: {},
      }),
    ).toThrowError(/at least one event/);
  });

  it('rejects a missing or invalid completion boundary', () => {
    expect(() =>
      validateScenarioSpec('bad', {
        completion: { mode: 'sometime' as never, observationBudgetMs: 100 },
        events: { a: {} },
      }),
    ).toThrowError(/completion mode/);
    expect(() =>
      validateScenarioSpec('bad', {
        completion: { mode: 'root-span-closed', observationBudgetMs: 0 },
        events: { a: {} },
      }),
    ).toThrowError(/positive number/);
  });

  it('rejects an unparseable cardinality with the event named', () => {
    expect(() =>
      validateScenarioSpec('bad', {
        completion: { mode: 'root-span-closed', observationBudgetMs: 100 },
        events: { a: { cardinality: 'several' } },
      }),
    ).toThrowError(/event "a".*unparseable/s);
  });

  it('rejects edges referencing undeclared events', () => {
    expect(() =>
      validateScenarioSpec('bad', {
        completion: { mode: 'root-span-closed', observationBudgetMs: 100 },
        events: { a: {} },
        edges: [['a', 'ghost']],
      }),
    ).toThrowError(/undeclared event/);
  });
});

describe('isScenarioClosed', () => {
  it('closes on the terminal event', () => {
    expect(isScenarioClosed(transferAccept, happyPath())).toBe(true);
    expect(
      isScenarioClosed(transferAccept, [span('transfer.request')]),
    ).toBe(false);
  });

  it('closes on a finished root span for root-span-closed', () => {
    const spec: ScenarioSpec = {
      completion: { mode: 'root-span-closed', observationBudgetMs: 100 },
      events: { a: {} },
    };
    expect(isScenarioClosed(spec, [span('a', { parentSpanId: 'p' })])).toBe(false);
    expect(isScenarioClosed(spec, [span('a')])).toBe(true);
  });

  it('never closes in-process for externally-reconciled', () => {
    const spec: ScenarioSpec = {
      completion: { mode: 'externally-reconciled', reconciliationDeadlineMs: 100 },
      events: { a: {} },
    };
    expect(isScenarioClosed(spec, [span('a')])).toBe(false);
  });

  it('treats workflow/phase completion as named closure signals', () => {
    const wf: ScenarioSpec = {
      completion: { mode: 'workflow-completed', workflow: 'payout', observationBudgetMs: 100 },
      events: { payout: {} },
    };
    expect(isScenarioClosed(wf, [span('payout')])).toBe(true);
    const phase: ScenarioSpec = {
      completion: { mode: 'phase-completed', phase: 'settle', observationBudgetMs: 100 },
      events: { settle: {} },
    };
    expect(isScenarioClosed(phase, [span('other')])).toBe(false);
  });
});

describe('evaluateScenario — three-state outcomes', () => {
  it('conformant: boundary closed, signature satisfied', () => {
    const result = evaluateScenario(transferAccept, happyPath(), {
      name: 'transfer.accept',
    });
    expect(result.outcome).toBe('conformant');
    expect(result.closed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('incomplete: boundary open, nothing definitive — NOT a failure', () => {
    const result = evaluateScenario(transferAccept, [
      span('transfer.request', { spanId: 'root' }),
      span('transfer.validate', { spanId: 'v1', parentSpanId: 'root' }),
    ]);
    expect(result.outcome).toBe('incomplete');
    expect(result.closed).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it('non-conformant: required event missing after closure', () => {
    const spans = happyPath().filter((s) => s.name !== 'transfer.validate');
    const result = evaluateScenario(transferAccept, spans);
    expect(result.outcome).toBe('non-conformant');
    // The absent event and its now-unsatisfiable edge are both reported.
    expect(result.violations).toEqual([
      expect.objectContaining({ code: 'missing_event', event: 'transfer.validate' }),
      expect.objectContaining({
        code: 'missing_edge',
        edge: ['transfer.request', 'transfer.validate'],
      }),
    ]);
  });

  it('absence is NOT reported while the boundary is open (closed-world only after closure)', () => {
    const result = evaluateScenario(transferAccept, [span('transfer.request')]);
    expect(
      result.violations.filter((v) => v.code === 'missing_event'),
    ).toEqual([]);
  });

  it('unexpected error is definitive even while open', () => {
    const result = evaluateScenario(transferAccept, [
      span('transfer.request', { spanId: 'root' }),
      span('transfer.validate', { spanId: 'v1', parentSpanId: 'root', status: 'error' }),
    ]);
    expect(result.outcome).toBe('non-conformant');
    expect(result.closed).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ code: 'unexpected_error', event: 'transfer.validate' }),
    ]);
  });

  it('a declared status:error event may fail without violation', () => {
    const spec: ScenarioSpec = {
      ...transferAccept,
      events: {
        ...transferAccept.events,
        'transfer.retry': { cardinality: 'at most 3', status: 'error' },
      },
    };
    const result = evaluateScenario(spec, [
      ...happyPath(),
      span('transfer.retry', { spanId: 'r1', parentSpanId: 'root', status: 'error' }),
    ]);
    expect(result.outcome).toBe('conformant');
  });

  it('max cardinality exceeded is definitive even while open', () => {
    const result = evaluateScenario(transferAccept, [
      span('transfer.request', { spanId: 'root' }),
      span('transfer.retry', { spanId: 'r1', parentSpanId: 'root' }),
      span('transfer.retry', { spanId: 'r2', parentSpanId: 'root' }),
      span('transfer.retry', { spanId: 'r3', parentSpanId: 'root' }),
      span('transfer.retry', { spanId: 'r4', parentSpanId: 'root' }),
    ]);
    expect(result.closed).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'cardinality_violation',
        event: 'transfer.retry',
      }),
    ]);
  });

  it('min cardinality below target after closure is a violation with the count', () => {
    const spec: ScenarioSpec = {
      ...transferAccept,
      events: { ...transferAccept.events, 'transfer.validate': { cardinality: 'exactly 2' } },
    };
    const result = evaluateScenario(spec, happyPath());
    expect(result.violations).toEqual([
      expect.objectContaining({ code: 'cardinality_violation', event: 'transfer.validate' }),
    ]);
  });

  it('edge checks use ancestry, so an inserted infra span does not break the contract', () => {
    const result = evaluateScenario(transferAccept, [
      span('transfer.request', { spanId: 'root' }),
      span('http.client', { spanId: 'infra', parentSpanId: 'root' }),
      span('transfer.validate', { spanId: 'v1', parentSpanId: 'infra' }),
      span('transfer.queued', { spanId: 'q1', parentSpanId: 'root' }),
    ]);
    expect(result.violations.filter((v) => v.code === 'missing_edge')).toEqual([]);
  });

  it('a required edge missing after closure is a violation', () => {
    const result = evaluateScenario(transferAccept, [
      span('transfer.request', { spanId: 'root' }),
      span('transfer.validate', { spanId: 'v1' }), // orphan — not under request
      span('transfer.queued', { spanId: 'q1', parentSpanId: 'root' }),
    ]);
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'missing_edge',
        edge: ['transfer.request', 'transfer.validate'],
      }),
    ]);
  });

  it('undeclared events are additive: reported, never failing', () => {
    const result = evaluateScenario(transferAccept, [
      ...happyPath(),
      span('fraud.check', { spanId: 'f1', parentSpanId: 'root' }),
    ]);
    expect(result.outcome).toBe('conformant');
    expect(result.additions).toEqual([
      expect.objectContaining({ code: 'undeclared_event', event: 'fraud.check', count: 1 }),
    ]);
  });
});

describe('checkScenario — polling with an observation budget', () => {
  it('waits for an async flow to close, then reports conformant', async () => {
    const spans: ScenarioSpan[] = [span('transfer.request', { spanId: 'root' })];
    setTimeout(() => {
      spans.push(
        span('transfer.validate', { spanId: 'v1', parentSpanId: 'root' }),
        span('transfer.queued', { spanId: 'q1', parentSpanId: 'root' }),
      );
    }, 50);
    const result = await checkScenario(transferAccept, () => spans, {
      name: 'transfer.accept',
      pollIntervalMs: 5,
    });
    expect(result.outcome).toBe('conformant');
  });

  it('reports incomplete — not non-conformant — when the budget expires first', async () => {
    const result = await checkScenario(
      transferAccept,
      () => [span('transfer.request', { spanId: 'root' })],
      { budgetMs: 40, pollIntervalMs: 5 },
    );
    expect(result.outcome).toBe('incomplete');
    expect(result.violations).toEqual([]);
  });

  it('fails fast on a definitive violation without waiting out the budget', async () => {
    const start = Date.now();
    const result = await checkScenario(
      transferAccept,
      () => [
        span('transfer.request', { spanId: 'root' }),
        span('transfer.validate', { spanId: 'v1', parentSpanId: 'root', status: 'error' }),
      ],
      { budgetMs: 5000, pollIntervalMs: 5 },
    );
    expect(result.outcome).toBe('non-conformant');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('evaluates externally-reconciled boundaries once, as incomplete', async () => {
    const spec: ScenarioSpec = {
      completion: { mode: 'externally-reconciled', reconciliationDeadlineMs: 1 },
      events: { 'payout.settled': {} },
    };
    const result = await checkScenario(spec, () => [span('payout.submitted')]);
    expect(result.outcome).toBe('incomplete');
  });
});

describe('formatScenarioResult', () => {
  it('names the scenario, outcome, violations, and additions', () => {
    const result = evaluateScenario(
      transferAccept,
      [
        span('transfer.request', { spanId: 'root' }),
        span('transfer.queued', { spanId: 'q1', parentSpanId: 'root' }),
        span('fraud.check', { spanId: 'f1', parentSpanId: 'root' }),
      ],
      { name: 'transfer.accept' },
    );
    const text = formatScenarioResult(result);
    expect(text).toContain('transfer.accept');
    expect(text).toContain('non-conformant');
    expect(text).toContain('transfer.validate');
    expect(text).toContain('fraud.check');
  });
});

describe('proposeScenario — record → propose → commit', () => {
  /** Build a timed run; `withNotification` exercises the variable path. */
  function run(withNotification: boolean): ScenarioSpan[] {
    const spans = [
      span('transfer.request', { spanId: 'root', startTimeMs: 0, durationMs: 100 }),
      span('transfer.validate', { spanId: 'v1', parentSpanId: 'root', startTimeMs: 5, durationMs: 20 }),
      span('transfer.queued', { spanId: 'q1', parentSpanId: 'root', startTimeMs: 30, durationMs: 80 }),
    ];
    if (withNotification) {
      spans.push(
        span('notification.send', { spanId: 'n1', parentSpanId: 'root', startTimeMs: 40, durationMs: 10 }),
      );
    }
    return spans;
  }

  it('stable events become exact cardinality, variable ones a range with a note', () => {
    const { scenario, notes } = proposeScenario([run(true), run(false), run(true)]);
    expect(scenario.events['transfer.validate']).toEqual({ cardinality: 'exactly 1' });
    expect(scenario.events['notification.send']).toEqual({
      cardinality: { min: 0, max: 1 },
    });
    expect(notes.join('\n')).toMatch(/notification\.send: 0\.\.1 \(2\/3 runs\)/);
  });

  it('edges present in every run are required; sometimes-present are optional', () => {
    const { scenario } = proposeScenario([run(true), run(false)]);
    expect(scenario.edges).toContainEqual(['transfer.request', 'transfer.validate']);
    expect(scenario.optionalEdges).toContainEqual(['transfer.request', 'notification.send']);
  });

  it('suggests a terminal-event completion from the consistent last-ending span', () => {
    const { scenario } = proposeScenario([run(false), run(false)]);
    expect(scenario.completion).toEqual({
      mode: 'terminal-event',
      event: 'transfer.queued',
      observationBudgetMs: expect.any(Number),
    });
  });

  it('derives the budget from observed makespan, floored at 1s', () => {
    const { scenario } = proposeScenario([run(false)]);
    const budget = (scenario.completion as { observationBudgetMs: number })
      .observationBudgetMs;
    expect(budget).toBeGreaterThanOrEqual(1000);
  });

  it('falls back to root-span-closed with a default budget when timing is absent', () => {
    const untimed = [
      span('a', { spanId: 'root' }),
      span('b', { spanId: 'b1', parentSpanId: 'root' }),
    ];
    const { scenario, notes } = proposeScenario([untimed]);
    expect(scenario.completion.mode).toBe('root-span-closed');
    expect(notes.join('\n')).toContain('no timing data');
  });

  it('the proposed draft round-trips: it validates and passes its own runs', () => {
    const runs = [run(true), run(false), run(true)];
    const { scenario } = proposeScenario(runs, { name: 'transfer.accept' });
    for (const recorded of runs) {
      const result = evaluateScenario(scenario, recorded, { closed: true });
      expect(result.outcome).toBe('conformant');
    }
  });

  it('flags events observed with error status for review', () => {
    const { notes } = proposeScenario([
      [span('a', { spanId: 'root' }), span('b', { spanId: 'b1', parentSpanId: 'root', status: 'error' })],
    ]);
    expect(notes.join('\n')).toMatch(/b: observed with status error/);  });

  it('requires at least one run', () => {
    expect(() => proposeScenario([])).toThrowError(/at least one/);
  });
});
