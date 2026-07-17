/**
 * Scenario conformance — a flow-level contract checked against collected spans.
 *
 * Where {@link ./contract} declares the *surface* of your telemetry (span
 * names + attributes), a scenario declares the *behaviour* of one exercised
 * flow: which events must fire, how many times, in what parent/child
 * topology, and — critically — **when the observation is complete**, because
 * for an async flow a missing event and an event that has not fired *yet* are
 * indistinguishable without a completion boundary.
 *
 * Checking a scenario yields one of three outcomes, not two:
 *
 * - `conformant` — the boundary closed and the signature satisfied the contract
 * - `non-conformant` — required behaviour was missing or invalid (definitive)
 * - `incomplete` — the boundary did not close within the observation budget;
 *   infrastructure slowness is *not* reported as behavioural regression
 *
 * Absence is definitive only after closure (closed-world semantics). Excess
 * is definitive immediately: a `max` cardinality violation or an unexpected
 * error span fails the check even while the flow is still open.
 *
 * Undeclared events are **additive**: reported in `result.additions`, never a
 * failure — improving instrumentation must not break CI.
 *
 * The span input shape is structurally compatible with `SerializedSpan` from
 * `autotel/test-span-collector`, so a test can feed a collector's output
 * straight in. Like the rest of this package the module is dependency-free —
 * usable from vitest, a deferred reconciliation job, or a CLI alike.
 *
 * @example
 * ```ts
 * const result = await checkScenario(
 *   contract.scenarios!['transfer.accept'],
 *   () => collector.peekTrace(traceId),
 *   { name: 'transfer.accept' },
 * );
 * if (result.outcome === 'non-conformant') throw new Error(formatScenarioResult(result));
 * ```
 */

/** A finished span/event as the scenario checker sees it. */
export interface ScenarioSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  status: 'ok' | 'error' | 'unset';
  attributes?: Record<string, unknown>;
  /** Epoch ms. Optional — used by {@link proposeScenario} to suggest budgets. */
  startTimeMs?: number;
  durationMs?: number;
}

/** Canonical cardinality range. `max` omitted = unbounded. */
export interface Cardinality {
  min: number;
  max?: number;
}

/**
 * Parse a cardinality shorthand: `'exactly 1'`, `'at least 1'`, `'at most 3'`,
 * `'0..1'`, `'2..'`. A canonical {@link Cardinality} passes through.
 */
export function parseCardinality(input: string | Cardinality): Cardinality {
  if (typeof input !== 'string') {
    assert(
      Number.isInteger(input.min) && input.min >= 0,
      `cardinality min must be a non-negative integer, got ${input.min}`,
    );
    assert(
      input.max === undefined ||
        (Number.isInteger(input.max) && input.max >= input.min),
      `cardinality max must be >= min, got ${input.max}`,
    );
    return input;
  }
  const exact = /^exactly (\d+)$/.exec(input);
  if (exact) return { min: Number(exact[1]), max: Number(exact[1]) };
  const atLeast = /^at least (\d+)$/.exec(input);
  if (atLeast) return { min: Number(atLeast[1]) };
  const atMost = /^at most (\d+)$/.exec(input);
  if (atMost) return { min: 0, max: Number(atMost[1]) };
  const range = /^(\d+)\.\.(\d*)$/.exec(input);
  if (range) {
    const min = Number(range[1]);
    const max = range[2] === '' ? undefined : Number(range[2]);
    assert(max === undefined || max >= min, `cardinality "${input}" has max < min`);
    return { min, max };
  }
  throw new Error(
    `autotel-schema: unparseable cardinality "${input}" (expected "exactly N", "at least N", "at most N", or "N..M")`,
  );
}

/** Declaration for one event (span name) a scenario expects to observe. */
export interface ScenarioEventSpec {
  /** How many occurrences are permitted. Defaults to `'at least 1'`. */
  cardinality?: string | Cardinality;
  /**
   * Expected terminal status. Defaults to non-error: an `error` status on an
   * event not declared `status: 'error'` is a definitive violation.
   */
  status?: 'ok' | 'error';
  description?: string;
}

/**
 * How the observed phase of a scenario becomes complete. Every async
 * conformance check must declare this — it is what makes absence meaningful.
 *
 * `externally-reconciled` never closes in-process: the phase is verified
 * elsewhere (a deferred reconciliation job keyed by a durable business ID),
 * so an in-process check reports at most definitive violations, never absence.
 */
export type CompletionBoundary =
  | { mode: 'root-span-closed'; observationBudgetMs: number }
  | { mode: 'terminal-event'; event: string; observationBudgetMs: number }
  | { mode: 'externally-reconciled'; reconciliationDeadlineMs: number };

/** The flow-level contract for one exercised scenario (or one phase of one). */
export interface ScenarioSpec {
  description?: string;
  /** When the observed phase is complete. See {@link CompletionBoundary}. */
  completion: CompletionBoundary;
  /** Events this scenario must (or may) observe, keyed by span name. */
  events: Record<string, ScenarioEventSpec>;
  /**
   * Required ancestor→descendant edges by span name. Ancestor — not immediate
   * parent — so a framework span inserted between the two does not break the
   * contract (canonicalisation: infrastructure spans are not behaviour).
   */
  edges?: ReadonlyArray<readonly [string, string]>;
  /** Edges that may appear but are not required. Documented, never enforced. */
  optionalEdges?: ReadonlyArray<readonly [string, string]>;
}

export type ScenarioOutcome = 'conformant' | 'non-conformant' | 'incomplete';

export type ScenarioViolationCode =
  | 'missing_event'
  | 'cardinality_violation'
  | 'missing_edge'
  | 'unexpected_error';

/** A definitive (breaking) discrepancy between observed spans and the scenario. */
export interface ScenarioViolation {
  code: ScenarioViolationCode;
  event?: string;
  edge?: readonly [string, string];
  message: string;
}

/** An additive observation — reported, never a failure. */
export interface ScenarioAddition {
  code: 'undeclared_event';
  event: string;
  count: number;
  message: string;
}

export interface ScenarioResult {
  scenario: string;
  outcome: ScenarioOutcome;
  /** Whether the completion boundary closed within the observation window. */
  closed: boolean;
  violations: ScenarioViolation[];
  additions: ScenarioAddition[];
  /** The evaluated snapshot — assert business values on this in your test. */
  spans: ScenarioSpan[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`autotel-schema: ${message}`);
  }
}

const COMPLETION_MODES = [
  'root-span-closed',
  'terminal-event',
  'externally-reconciled',
] as const;

/**
 * Structural validation for one scenario declaration. Called by
 * `defineContract()` so a malformed scenario throws at module load.
 */
export function validateScenarioSpec(name: string, spec: ScenarioSpec): void {
  const scope = `scenario "${name}"`;
  assert(
    spec.completion && typeof spec.completion === 'object',
    `${scope} must declare a completion boundary`,
  );
  assert(
    (COMPLETION_MODES as readonly string[]).includes(spec.completion.mode),
    `${scope} has invalid completion mode "${(spec.completion as { mode: string }).mode}"`,
  );
  const budget =
    spec.completion.mode === 'externally-reconciled'
      ? spec.completion.reconciliationDeadlineMs
      : spec.completion.observationBudgetMs;
  assert(
    typeof budget === 'number' && Number.isFinite(budget) && budget > 0,
    `${scope} completion budget must be a positive number of milliseconds`,
  );
  switch (spec.completion.mode) {
    case 'terminal-event':
      assert(
        typeof spec.completion.event === 'string' && spec.completion.event.length > 0,
        `${scope} terminal-event completion must declare a non-empty event`,
      );
      break;
  }
  assert(
    spec.events &&
      typeof spec.events === 'object' &&
      Object.keys(spec.events).length > 0,
    `${scope} must declare at least one event`,
  );
  for (const [event, eventSpec] of Object.entries(spec.events)) {
    if (eventSpec.cardinality !== undefined) {
      try {
        parseCardinality(eventSpec.cardinality);
      } catch (error) {
        throw new Error(
          `autotel-schema: ${scope} event "${event}": ${(error as Error).message}`,
        );
      }
    }
    if (eventSpec.status !== undefined) {
      assert(
        eventSpec.status === 'ok' || eventSpec.status === 'error',
        `${scope} event "${event}" has invalid status "${eventSpec.status}"`,
      );
    }
  }
  for (const [from, to] of [...(spec.edges ?? []), ...(spec.optionalEdges ?? [])]) {
    assert(
      from in spec.events && to in spec.events,
      `${scope} edge ["${from}", "${to}"] references an undeclared event — declare both endpoints in events`,
    );
  }
}

/** Whether the scenario's completion boundary has closed for these spans. */
export function isScenarioClosed(
  spec: ScenarioSpec,
  spans: readonly ScenarioSpan[],
): boolean {
  const { completion } = spec;
  switch (completion.mode) {
    case 'externally-reconciled':
      return false;
    case 'root-span-closed':
      // Only finished spans reach a collector, so a present root = a closed root.
      return spans.some((s) => !s.parentSpanId);
    case 'terminal-event':
      return spans.some((s) => s.name === completion.event);
  }
}

/** True when `span` has an ancestor named `ancestorName` within `byId`. */
function hasAncestorNamed(
  span: ScenarioSpan,
  ancestorName: string,
  byId: ReadonlyMap<string, ScenarioSpan>,
): boolean {
  const seen = new Set<string>();
  let parentId = span.parentSpanId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return false;
    if (parent.name === ancestorName) return true;
    parentId = parent.parentSpanId;
  }
  return false;
}

export interface EvaluateScenarioOptions {
  /** Name used in the result/messages. Defaults to `'scenario'`. */
  name?: string;
  /** Override closure detection (e.g. the poller already knows). */
  closed?: boolean;
}

/**
 * Pure three-state evaluation of collected spans against a scenario.
 *
 * Definitive at any time (no closure needed): an unexpected error status, a
 * `max` cardinality exceeded. Meaningful only after closure: a missing event,
 * a `min` cardinality not reached, a missing required edge.
 */
export function evaluateScenario(
  spec: ScenarioSpec,
  spans: readonly ScenarioSpan[],
  options?: EvaluateScenarioOptions,
): ScenarioResult {
  const name = options?.name ?? 'scenario';
  const closed = options?.closed ?? isScenarioClosed(spec, spans);
  const violations: ScenarioViolation[] = [];
  const additions: ScenarioAddition[] = [];

  const countByName = new Map<string, number>();
  for (const span of spans) {
    countByName.set(span.name, (countByName.get(span.name) ?? 0) + 1);
  }

  // Unexpected error status — definitive even while the flow is open.
  for (const span of spans) {
    if (span.status === 'error' && spec.events[span.name]?.status !== 'error') {
      violations.push({
        code: 'unexpected_error',
        event: span.name,
        message: `"${span.name}" ended with status error, which the scenario does not declare`,
      });
    }
  }

  for (const [event, eventSpec] of Object.entries(spec.events)) {
    const { min, max } = parseCardinality(
      eventSpec.cardinality ?? { min: 1 },
    );
    const count = countByName.get(event) ?? 0;

    // Excess is definitive immediately.
    if (max !== undefined && count > max) {
      violations.push({
        code: 'cardinality_violation',
        event,
        message: `"${event}" observed ${count}×, contract allows at most ${max}`,
      });
    }
    // Absence is definitive only after closure.
    if (closed && count < min) {
      violations.push({
        code: count === 0 ? 'missing_event' : 'cardinality_violation',
        event,
        message:
          count === 0
            ? `"${event}" was not observed and the completion boundary has closed`
            : `"${event}" observed ${count}×, contract requires at least ${min}`,
      });
    }
  }

  if (closed) {
    const byId = new Map<string, ScenarioSpan>();
    for (const span of spans) byId.set(span.spanId, span);
    for (const [from, to] of spec.edges ?? []) {
      const satisfied = spans.some(
        (s) => s.name === to && hasAncestorNamed(s, from, byId),
      );
      if (!satisfied) {
        violations.push({
          code: 'missing_edge',
          edge: [from, to],
          message: `no "${to}" span has ancestor "${from}"`,
        });
      }
    }
  }

  for (const [event, count] of [...countByName.entries()].toSorted()) {
    if (!(event in spec.events)) {
      additions.push({
        code: 'undeclared_event',
        event,
        count,
        message: `"${event}" observed ${count}× but not declared — additive, consider adding it to the scenario`,
      });
    }
  }

  return {
    scenario: name,
    outcome:
      violations.length > 0
        ? 'non-conformant'
        : closed
          ? 'conformant'
          : 'incomplete',
    closed,
    violations,
    additions,
    spans: [...spans],
  };
}

export interface CheckScenarioOptions {
  /** Name used in the result/messages. Defaults to `'scenario'`. */
  name?: string;
  /** Poll interval while waiting for closure. Default 25ms. */
  pollIntervalMs?: number;
  /** Override the boundary's observation budget (how long the checker waits). */
  budgetMs?: number;
}

/**
 * Poll `getSpans` until the scenario's completion boundary closes, a
 * definitive violation appears (fail fast), or the observation budget is
 * spent — then evaluate.
 *
 * The observation budget bounds how long *this checker* waits; it is not a
 * statement that the operation is allowed to take that long. Express a
 * business deadline as its own assertion on the returned spans.
 *
 * An `externally-reconciled` boundary never closes in-process: the check
 * evaluates the current snapshot once and reports `incomplete` unless a
 * definitive violation is already present.
 */
export async function checkScenario(
  spec: ScenarioSpec,
  getSpans: () => readonly ScenarioSpan[] | Promise<readonly ScenarioSpan[]>,
  options?: CheckScenarioOptions,
): Promise<ScenarioResult> {
  const name = options?.name;
  if (spec.completion.mode === 'externally-reconciled') {
    return evaluateScenario(spec, await getSpans(), { name });
  }
  const budgetMs = options?.budgetMs ?? spec.completion.observationBudgetMs;
  const pollIntervalMs = options?.pollIntervalMs ?? 25;
  assert(
    Number.isFinite(budgetMs) && budgetMs > 0,
    'checkScenario budgetMs must be a positive number of milliseconds',
  );
  assert(
    Number.isFinite(pollIntervalMs) && pollIntervalMs >= 0,
    'checkScenario pollIntervalMs must be a non-negative number of milliseconds',
  );
  const deadline = Date.now() + budgetMs;
  let lastResult = evaluateScenario(spec, [], { name });

  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return lastResult;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let next:
      | { kind: 'spans'; spans: readonly ScenarioSpan[] }
      | { kind: 'timeout' };
    try {
      next = await Promise.race([
        Promise.resolve()
          .then(getSpans)
          .then((spans) => ({ kind: 'spans' as const, spans })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: 'timeout' }), remainingMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    if (next.kind === 'timeout') return lastResult;

    const { spans } = next;
    const result = evaluateScenario(spec, spans, { name });
    lastResult = result;
    if (result.closed || result.outcome === 'non-conformant') return result;
    const waitMs = Math.min(pollIntervalMs, deadline - Date.now());
    if (waitMs <= 0) return result; // incomplete
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/** Human-readable summary of a scenario result, for assertion messages. */
export function formatScenarioResult(result: ScenarioResult): string {
  const lines = [
    `scenario "${result.scenario}": ${result.outcome}${result.closed ? '' : ' (completion boundary did not close)'}`,
  ];
  for (const v of result.violations) lines.push(`  ✗ ${v.message}`);
  for (const a of result.additions) lines.push(`  + ${a.message}`);
  return lines.join('\n');
}

export interface ScenarioProposal {
  scenario: ScenarioSpec;
  /** Review annotations — what was observed and what to double-check. */
  notes: string[];
}

/**
 * Draft a scenario contract from repeated controlled runs (record → propose →
 * commit). Events stable across every run become required with their observed
 * cardinality; variable ones get a range and a review note. The draft is a
 * starting point for human curation, not a finished contract.
 */
export function proposeScenario(
  runs: ReadonlyArray<ReadonlyArray<ScenarioSpan>>,
  options?: { name?: string },
): ScenarioProposal {
  assert(runs.length > 0, 'proposeScenario needs at least one recorded run');
  for (const [index, run] of runs.entries()) {
    assert(run.length > 0, `proposeScenario run ${index + 1} has no recorded spans`);
  }
  const name = options?.name ?? 'scenario';
  const notes: string[] = [];
  const total = runs.length;

  // Occurrence counts per event name per run (0 when absent).
  const names = new Set<string>();
  const countsPerRun: Array<Map<string, number>> = runs.map((run) => {
    const counts = new Map<string, number>();
    for (const span of run) {
      names.add(span.name);
      counts.set(span.name, (counts.get(span.name) ?? 0) + 1);
    }
    return counts;
  });

  const events: Record<string, ScenarioEventSpec> = {};
  for (const event of [...names].toSorted()) {
    const counts = countsPerRun.map((c) => c.get(event) ?? 0);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const seenIn = counts.filter((c) => c > 0).length;
    events[event] = {
      cardinality: min === max ? `exactly ${min}` : { min, max },
    };
    notes.push(
      min === max
        ? `${event}: exactly ${min} (${seenIn}/${total} runs)`
        : `${event}: ${min}..${max} (${seenIn}/${total} runs) — review: variable`,
    );
    if (runs.some((run) => run.some((s) => s.name === event && s.status === 'error'))) {
      notes.push(`${event}: observed with status error — review: expected?`);
    }
  }

  // Immediate parent→child name pairs; present in every run → required edge.
  const edgeRuns = new Map<string, number>();
  for (const run of runs) {
    const byId = new Map(run.map((s) => [s.spanId, s]));
    const pairs = new Set<string>();
    for (const span of run) {
      const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
      if (parent) pairs.add(`${parent.name} ${span.name}`);
    }
    for (const pair of pairs) edgeRuns.set(pair, (edgeRuns.get(pair) ?? 0) + 1);
  }
  const edges: Array<readonly [string, string]> = [];
  const optionalEdges: Array<readonly [string, string]> = [];
  for (const [pair, seen] of [...edgeRuns.entries()].toSorted()) {
    const [from, to] = pair.split(' ') as [string, string];
    if (seen === total) {
      edges.push([from, to]);
    } else {
      optionalEdges.push([from, to]);
      notes.push(`edge ${from} → ${to}: ${seen}/${total} runs — proposed optional`);
    }
  }

  // Completion: consistent last-ending span → terminal event; else root closure.
  // Budget: 3× the slowest observed makespan when timing data is present.
  let completion: CompletionBoundary;
  const lastNames = new Set<string>();
  let maxMakespanMs = 0;
  let hasTiming = true;
  for (const run of runs) {
    let last: ScenarioSpan | undefined;
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const span of run) {
      if (span.startTimeMs === undefined || span.durationMs === undefined) {
        hasTiming = false;
        break;
      }
      const spanEnd = span.startTimeMs + span.durationMs;
      start = Math.min(start, span.startTimeMs);
      if (spanEnd >= end) {
        end = spanEnd;
        last = span;
      }
    }
    if (!hasTiming) break;
    if (last) lastNames.add(last.name);
    maxMakespanMs = Math.max(maxMakespanMs, end - start);
  }
  const observationBudgetMs = hasTiming
    ? Math.max(1000, Math.ceil(maxMakespanMs * 3))
    : 30_000;
  if (hasTiming && lastNames.size === 1) {
    const [event] = [...lastNames] as [string];
    completion = { mode: 'terminal-event', event, observationBudgetMs };
    notes.push(
      `completion: terminal-event "${event}" (last to end in all ${total} runs), budget ${observationBudgetMs}ms (3× slowest observed run)`,
    );
  } else {
    completion = { mode: 'root-span-closed', observationBudgetMs };
    notes.push(
      hasTiming
        ? `completion: root-span-closed (last-ending span varies: ${[...lastNames].toSorted().join(', ')}), budget ${observationBudgetMs}ms`
        : `completion: root-span-closed, budget ${observationBudgetMs}ms (default — no timing data recorded)`,
    );
  }

  const scenario: ScenarioSpec = {
    description: `Proposed from ${total} recorded run${total === 1 ? '' : 's'} of ${name} — review before committing`,
    completion,
    events,
    ...(edges.length > 0 ? { edges } : {}),
    ...(optionalEdges.length > 0 ? { optionalEdges } : {}),
  };
  validateScenarioSpec(name, scenario);
  return { scenario, notes };
}
