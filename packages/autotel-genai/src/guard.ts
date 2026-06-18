/**
 * GenAI guard / budget runtime — an in-process kill-switch for agent runs.
 *
 * Most tracing tells you what an agent _did_, after the fact. A guard runs
 * _during_ the run: you feed it each step (an LLM call, a tool call, a
 * delegation), it accumulates cost / tokens / loop state, and evaluates a set
 * of rules. When a rule crosses its threshold the guard either records a
 * warning and lets the run continue, or stops the run — aborting an
 * {@link AbortSignal} and (by default) throwing a structured error so the agent
 * loop unwinds. No prompt, no retry, no runaway bill.
 *
 * This is the inline, OpenTelemetry-native analogue of a `watch` kill-switch:
 * cost ceilings, token ceilings, max tool calls, wall-clock timeouts, and
 * spin-loop / error-loop detection — all pure, deterministic logic with no LLM
 * in the loop.
 *
 * @example Budget ceiling that halts a runaway agent
 * ```typescript
 * import { createGenAiBudget } from 'autotel-genai/guard';
 * import { estimateLLMCost } from 'autotel-genai/cost';
 *
 * const budget = createGenAiBudget({ maxCostUsd: 5, warnAtUsd: 4 });
 *
 * for (const task of tasks) {
 *   if (budget.stopped) break;
 *   const res = await model.chat(task);
 *   budget.record(
 *     {
 *       kind: 'llm',
 *       usage: {
 *         costUsd: estimateLLMCost('gpt-4o', {
 *           inputTokens: res.usage.input,
 *           outputTokens: res.usage.output,
 *         }),
 *       },
 *     },
 *     ctx, // optional TraceContext — records gen_ai.guard.* telemetry
 *   ); // throws GEN_AI_GUARD_STOP once total cost > $5
 * }
 * ```
 *
 * @example Loop detection from a shorthand rule string
 * ```typescript
 * import { createGenAiGuard, parseGuardRules } from 'autotel-genai/guard';
 *
 * const guard = createGenAiGuard({
 *   rules: parseGuardRules('budget:$2,loop:3/10,max-tools:50,timeout:5m'),
 * });
 *
 * guard.record({ kind: 'tool', name: 'search', signature: JSON.stringify(args) });
 * ```
 */

import { createStructuredError, type TraceContext } from 'autotel';
import { GEN_AI, GEN_AI_GUARD_EVENT } from './semconv.js';

/** What a rule does when it crosses its threshold. */
export type GuardAction = 'warn' | 'stop';

/** Usage contribution for a single step. */
export interface GuardUsage {
  /**
   * Estimated USD cost for this step. Pair with
   * {@link import('./cost.js').estimateLLMCost} to compute it from token usage.
   */
  costUsd?: number;
  /** Input (prompt) tokens for this step. */
  inputTokens?: number;
  /** Output (completion) tokens for this step. */
  outputTokens?: number;
}

/** A single supervised step: an LLM call, a tool call, a delegation, … */
export interface GenAiGuardStep {
  /**
   * Step kind. `tool` increments the tool-call counter; any value is allowed.
   */
  kind?: 'llm' | 'tool' | 'agent' | 'workflow' | (string & {});
  /** Operation or tool name — used together with {@link signature} for loops. */
  name?: string;
  /**
   * Stable signature of the call inputs (e.g. `JSON.stringify(args)`). Two
   * steps with the same `name` + `signature` count as identical for spin-loop
   * detection. Hash or truncate it yourself if the raw args are large.
   */
  signature?: string;
  /** Whether this step failed. Drives error-loop detection. */
  error?: boolean;
  /** Cost / token contribution to the running totals. */
  usage?: GuardUsage;
}

/** Read-only snapshot of the accumulated session state. */
export interface GuardState {
  /** Epoch ms when the guard was created. */
  readonly startedAt: number;
  /** Epoch ms at evaluation time. */
  readonly now: number;
  /** Wall-clock ms since {@link startedAt}. */
  readonly elapsedMs: number;
  /** Accumulated estimated cost in USD. */
  readonly costUsd: number;
  /** Accumulated input tokens. */
  readonly inputTokens: number;
  /** Accumulated output tokens. */
  readonly outputTokens: number;
  /** Total steps recorded. */
  readonly stepCount: number;
  /** Steps with `kind === 'tool'`. */
  readonly toolCallCount: number;
  /** Steps with `error === true`. */
  readonly errorCount: number;
  /** Bounded recent history (newest last) for loop detection. */
  readonly history: ReadonlyArray<{ key: string | undefined; error: boolean }>;
}

/** A fired rule. */
export interface GuardViolation {
  /** Rule name, e.g. `cost-ceiling:$5`. */
  rule: string;
  /** Whether the run continued (`warn`) or was halted (`stop`). */
  action: GuardAction;
  /** Human-readable explanation. */
  message: string;
  /** The observed value that crossed the threshold. */
  observed: number;
  /** The configured threshold. */
  limit: number;
}

/** A guard rule: inspect the state after a step and optionally fire. */
export interface GenAiGuardRule {
  /** Stable identifier, surfaced on {@link GuardViolation.rule}. */
  name: string;
  /** Default {@link GuardAction} when the rule fires. Defaults to `stop`. */
  action?: GuardAction;
  /**
   * Evaluate against the post-step state and the step just recorded (absent on
   * a bare {@link GenAiGuard.check}). Return a partial violation to fire, or
   * `undefined` to pass.
   */
  evaluate: (
    state: GuardState,
    step: GenAiGuardStep | undefined,
  ) => { message: string; observed: number; limit: number } | undefined;
}

/** Minimal telemetry sink — the subset of {@link TraceContext} the guard uses. */
export type GuardSink = Pick<TraceContext, 'setAttributes' | 'track'>;

/** What happens when a `stop` rule fires. */
export type GuardStopBehavior =
  /** Abort the signal and throw a structured error (default). */
  | 'throw'
  /** Abort the signal but do not throw — inspect `guard.stopped` yourself. */
  | 'abort'
  /** Record the violation only; neither abort nor throw. */
  | 'silent';

export interface GenAiGuardOptions {
  /** Rules to evaluate after each step. */
  rules: GenAiGuardRule[];
  /** What to do when a `stop` rule fires. Defaults to `throw`. */
  onStop?: GuardStopBehavior;
  /**
   * Max recent steps retained for loop detection. Defaults to 256; raise it if
   * a spin-loop rule uses a larger window.
   */
  historyLimit?: number;
  /** Clock injection point, for tests. Defaults to {@link Date.now}. */
  now?: () => number;
}

/** A live guard supervising an agent run. */
export interface GenAiGuard {
  /**
   * Record a step, accumulate its usage, and evaluate every rule. Returns the
   * violations that fired _this call_ (each rule fires at most once). When a
   * `stop` rule fires, aborts {@link signal} and — unless `onStop` is `abort` /
   * `silent` — throws a structured `GEN_AI_GUARD_STOP` error.
   */
  record(step: GenAiGuardStep, ctx?: GuardSink): GuardViolation[];
  /**
   * Re-evaluate the rules without recording a step. Useful for time-based
   * rules (e.g. a timeout) between LLM calls.
   */
  check(ctx?: GuardSink): GuardViolation[];
  /** Current accumulated state. */
  readonly state: GuardState;
  /** Fires once a `stop` rule has crossed its threshold. */
  readonly signal: AbortSignal;
  /** `true` after a `stop` rule has fired. */
  readonly stopped: boolean;
  /** Every violation fired so far, in order. */
  readonly violations: ReadonlyArray<GuardViolation>;
}

// --- Rule factories --------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Stop / warn when accumulated cost exceeds `limitUsd`. */
export function costCeiling(
  limitUsd: number,
  action: GuardAction = 'stop',
): GenAiGuardRule {
  return {
    name: `cost-ceiling:$${limitUsd}`,
    action,
    evaluate: (s) =>
      s.costUsd > limitUsd
        ? {
            message: `session cost $${round(s.costUsd)} exceeds $${limitUsd}`,
            observed: round(s.costUsd),
            limit: limitUsd,
          }
        : undefined,
  };
}

/** Stop / warn when accumulated input + output tokens exceed `limit`. */
export function tokenCeiling(
  limit: number,
  action: GuardAction = 'stop',
): GenAiGuardRule {
  return {
    name: `token-ceiling:${limit}`,
    action,
    evaluate: (s) => {
      const total = s.inputTokens + s.outputTokens;
      return total > limit
        ? {
            message: `session tokens ${total} exceed ${limit}`,
            observed: total,
            limit,
          }
        : undefined;
    },
  };
}

/** Stop / warn when the number of tool calls exceeds `limit`. */
export function maxToolCalls(
  limit: number,
  action: GuardAction = 'stop',
): GenAiGuardRule {
  return {
    name: `max-tool-calls:${limit}`,
    action,
    evaluate: (s) =>
      s.toolCallCount > limit
        ? {
            message: `tool calls ${s.toolCallCount} exceed ${limit}`,
            observed: s.toolCallCount,
            limit,
          }
        : undefined,
  };
}

/** Stop / warn when the total number of steps exceeds `limit`. */
export function maxSteps(
  limit: number,
  action: GuardAction = 'stop',
): GenAiGuardRule {
  return {
    name: `max-steps:${limit}`,
    action,
    evaluate: (s) =>
      s.stepCount > limit
        ? {
            message: `steps ${s.stepCount} exceed ${limit}`,
            observed: s.stepCount,
            limit,
          }
        : undefined,
  };
}

/** Stop / warn when wall-clock time since start exceeds `limitMs`. */
export function maxDuration(
  limitMs: number,
  action: GuardAction = 'stop',
): GenAiGuardRule {
  return {
    name: `max-duration:${limitMs}ms`,
    action,
    evaluate: (s) =>
      s.elapsedMs > limitMs
        ? {
            message: `elapsed ${s.elapsedMs}ms exceeds ${limitMs}ms`,
            observed: s.elapsedMs,
            limit: limitMs,
          }
        : undefined,
  };
}

/**
 * Stop / warn on a spin loop: the same step (`name` + `signature`) repeated
 * `count` or more times within the last `window` steps. Steps without a `name`
 * are ignored (no identity to compare).
 */
export function spinLoop(
  options: { count: number; window: number },
  action: GuardAction = 'stop',
): GenAiGuardRule {
  const { count, window } = options;
  return {
    name: `spin-loop:${count}/${window}`,
    action,
    evaluate: (s, step) => {
      const key = stepKey(step);
      if (key === undefined) return undefined;
      const recent = s.history.slice(-window);
      let occurrences = 0;
      for (const h of recent) if (h.key === key) occurrences++;
      return occurrences >= count
        ? {
            message: `step "${step?.name}" repeated ${occurrences}× in last ${window}`,
            observed: occurrences,
            limit: count,
          }
        : undefined;
    },
  };
}

/** Stop / warn on `count` or more consecutive failing steps. */
export function errorLoop(
  options: { count: number },
  action: GuardAction = 'stop',
): GenAiGuardRule {
  const { count } = options;
  return {
    name: `error-loop:${count}`,
    action,
    evaluate: (s) => {
      let streak = 0;
      for (let i = s.history.length - 1; i >= 0; i--) {
        if (s.history[i].error) streak++;
        else break;
      }
      return streak >= count
        ? {
            message: `${streak} consecutive errors`,
            observed: streak,
            limit: count,
          }
        : undefined;
    },
  };
}

/**
 * Approximate context-window sizes (in input tokens) for common models.
 * Matched exactly first, then by longest key prefix. Override via the `limit`
 * option on {@link contextBudget}.
 */
export const CONTEXT_LIMITS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4': 8192,
  'o3-mini': 200_000,
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3': 200_000,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
};

function resolveContextLimit(model: string): number | undefined {
  const exact = CONTEXT_LIMITS[model];
  if (exact) return exact;
  let best: number | undefined;
  let bestLength = 0;
  for (const key of Object.keys(CONTEXT_LIMITS)) {
    if (model.startsWith(key) && key.length > bestLength) {
      best = CONTEXT_LIMITS[key];
      bestLength = key.length;
    }
  }
  return best;
}

/**
 * Stop / warn when cumulative input tokens reach `threshold` (default 0.9) of
 * the model's context window. Provide an explicit `limit`, or a `model` to look
 * one up from {@link CONTEXT_LIMITS}.
 */
export function contextBudget(
  options: { model?: string; limit?: number; threshold?: number },
  action: GuardAction = 'stop',
): GenAiGuardRule {
  const threshold = options.threshold ?? 0.9;
  const limit =
    options.limit ?? (options.model ? resolveContextLimit(options.model) : undefined);
  return {
    name: `context-budget:${Math.round(threshold * 100)}%`,
    action,
    evaluate: (s) => {
      if (!limit) return undefined;
      const ratio = s.inputTokens / limit;
      return ratio >= threshold
        ? {
            message: `context ${Math.round(ratio * 100)}% full (${s.inputTokens}/${limit})`,
            observed: round(ratio),
            limit: threshold,
          }
        : undefined;
    },
  };
}

function stepKey(step: GenAiGuardStep | undefined): string | undefined {
  if (!step || step.name === undefined) return undefined;
  return `${step.name} ${step.signature ?? ''}`;
}

// --- Shorthand rule parser -------------------------------------------------

function parseScaledNumber(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kmb])?$/i.exec(raw.trim());
  if (!m) throw new Error(`invalid number: "${raw}"`);
  const value = Number.parseFloat(m[1]);
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() ?? ''] ?? 1;
  return value * scale;
}

function parseDurationMs(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(raw.trim());
  if (!m) throw new Error(`invalid duration: "${raw}"`);
  const value = Number.parseFloat(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit] ?? 1000;
  return value * scale;
}

/**
 * Parse a comma-separated shorthand rule string into {@link GenAiGuardRule}s.
 * All parsed rules default to the `stop` action — pass `defaultAction: 'warn'`
 * to warn instead, or build typed rules directly for per-rule actions.
 *
 * Supported tokens:
 * - `budget:$5` / `cost:$5` — {@link costCeiling}
 * - `tokens:100k` — {@link tokenCeiling} (`k`/`m`/`b` suffixes)
 * - `loop:3/10` — {@link spinLoop} (count / window)
 * - `errors:3` — {@link errorLoop}
 * - `max-tools:50` — {@link maxToolCalls}
 * - `max-steps:100` — {@link maxSteps}
 * - `timeout:30m` — {@link maxDuration} (`ms`/`s`/`m`/`h`, default seconds)
 * - `context:0.9` / `context:0.9@gpt-4o` — {@link contextBudget}
 */
export function parseGuardRules(
  shorthand: string,
  options?: { defaultAction?: GuardAction },
): GenAiGuardRule[] {
  const action = options?.defaultAction ?? 'stop';
  const rules: GenAiGuardRule[] = [];
  for (const token of shorthand.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep === -1) throw new Error(`invalid guard rule: "${trimmed}"`);
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const value = trimmed.slice(sep + 1).trim();

    switch (key) {
      case 'budget':
      case 'cost': {
        rules.push(costCeiling(parseScaledNumber(value.replace(/^\$/, '')), action));
        break;
      }
      case 'tokens': {
        rules.push(tokenCeiling(parseScaledNumber(value), action));
        break;
      }
      case 'loop': {
        const [count, window] = value.split('/');
        rules.push(
          spinLoop(
            { count: parseScaledNumber(count), window: parseScaledNumber(window) },
            action,
          ),
        );
        break;
      }
      case 'errors': {
        rules.push(errorLoop({ count: parseScaledNumber(value) }, action));
        break;
      }
      case 'max-tools': {
        rules.push(maxToolCalls(parseScaledNumber(value), action));
        break;
      }
      case 'max-steps': {
        rules.push(maxSteps(parseScaledNumber(value), action));
        break;
      }
      case 'timeout': {
        rules.push(maxDuration(parseDurationMs(value), action));
        break;
      }
      case 'context': {
        const [thr, model] = value.split('@');
        rules.push(
          contextBudget(
            { threshold: Number.parseFloat(thr), model: model?.trim() || undefined },
            action,
          ),
        );
        break;
      }
      default: {
        throw new Error(`unknown guard rule: "${key}"`);
      }
    }
  }
  return rules;
}

// --- Guard implementation --------------------------------------------------

function recordTelemetry(
  ctx: GuardSink,
  state: GuardState,
  newViolations: GuardViolation[],
  stopped: boolean,
): void {
  ctx.setAttributes({
    [GEN_AI.SESSION_COST_USD]: round(state.costUsd),
    [GEN_AI.SESSION_INPUT_TOKENS]: state.inputTokens,
    [GEN_AI.SESSION_OUTPUT_TOKENS]: state.outputTokens,
    [GEN_AI.SESSION_STEP_COUNT]: state.stepCount,
    [GEN_AI.SESSION_TOOL_CALL_COUNT]: state.toolCallCount,
    [GEN_AI.SESSION_ERROR_COUNT]: state.errorCount,
  });
  if (newViolations.length === 0) return;
  if (stopped) ctx.setAttributes({ [GEN_AI.GUARD_STOPPED]: true });
  for (const violation of newViolations) {
    ctx.track(
      violation.action === 'stop'
        ? GEN_AI_GUARD_EVENT.STOP
        : GEN_AI_GUARD_EVENT.WARNING,
      {
        [GEN_AI.GUARD_RULE]: violation.rule,
        [GEN_AI.GUARD_ACTION]: violation.action,
        [GEN_AI.GUARD_MESSAGE]: violation.message,
        [GEN_AI.GUARD_OBSERVED]: violation.observed,
        [GEN_AI.GUARD_LIMIT]: violation.limit,
      },
    );
  }
}

/**
 * Create a guard that supervises an in-process agent run against `rules`.
 */
export function createGenAiGuard(options: GenAiGuardOptions): GenAiGuard {
  const { rules } = options;
  const onStop = options.onStop ?? 'throw';
  const historyLimit = options.historyLimit ?? 256;
  const now = options.now ?? Date.now;
  const startedAt = now();

  const controller = new AbortController();
  const history: { key: string | undefined; error: boolean }[] = [];
  const fired = new Set<string>();
  const violations: GuardViolation[] = [];

  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stepCount = 0;
  let toolCallCount = 0;
  let errorCount = 0;
  let stopped = false;

  function snapshot(): GuardState {
    const at = now();
    return {
      startedAt,
      now: at,
      elapsedMs: at - startedAt,
      costUsd,
      inputTokens,
      outputTokens,
      stepCount,
      toolCallCount,
      errorCount,
      history,
    };
  }

  function evaluate(
    step: GenAiGuardStep | undefined,
    ctx: GuardSink | undefined,
  ): GuardViolation[] {
    const state = snapshot();
    const newViolations: GuardViolation[] = [];

    for (const rule of rules) {
      if (fired.has(rule.name)) continue;
      const hit = rule.evaluate(state, step);
      if (!hit) continue;
      fired.add(rule.name);
      const violation: GuardViolation = {
        rule: rule.name,
        action: rule.action ?? 'stop',
        message: hit.message,
        observed: hit.observed,
        limit: hit.limit,
      };
      violations.push(violation);
      newViolations.push(violation);
    }

    const stopViolation = newViolations.find((v) => v.action === 'stop');
    if (stopViolation && !stopped) {
      stopped = true;
      if (onStop !== 'silent') controller.abort(toStopError(stopViolation, state));
    }

    if (ctx) recordTelemetry(ctx, state, newViolations, stopped);

    if (stopViolation && onStop === 'throw') {
      throw toStopError(stopViolation, snapshot());
    }
    return newViolations;
  }

  return {
    record(step, ctx) {
      stepCount++;
      if (step.kind === 'tool') toolCallCount++;
      if (step.error) errorCount++;
      if (step.usage) {
        costUsd += step.usage.costUsd ?? 0;
        inputTokens += step.usage.inputTokens ?? 0;
        outputTokens += step.usage.outputTokens ?? 0;
      }
      history.push({ key: stepKey(step), error: step.error === true });
      if (history.length > historyLimit) history.shift();
      return evaluate(step, ctx);
    },
    check(ctx) {
      return evaluate(undefined, ctx);
    },
    get state() {
      return snapshot();
    },
    get signal() {
      return controller.signal;
    },
    get stopped() {
      return stopped;
    },
    get violations() {
      return violations;
    },
  };
}

function toStopError(violation: GuardViolation, state: GuardState): Error {
  return createStructuredError({
    name: 'GenAiGuardStop',
    code: 'GEN_AI_GUARD_STOP',
    status: 429,
    message: `Guard rule "${violation.rule}" halted the run: ${violation.message}`,
    why: 'A stop-action guard rule crossed its threshold during the agent run.',
    fix: 'Raise the limit, fix the loop, or handle GEN_AI_GUARD_STOP to wind the run down cleanly.',
    details: {
      rule: violation.rule,
      observed: violation.observed,
      limit: violation.limit,
      costUsd: round(state.costUsd),
      stepCount: state.stepCount,
    },
  });
}

// --- Budget preset ---------------------------------------------------------

export interface GenAiBudgetOptions {
  /** Hard cost ceiling in USD — a `stop` rule. */
  maxCostUsd?: number;
  /** Soft cost threshold in USD — a `warn` rule. */
  warnAtUsd?: number;
  /** Hard token ceiling (input + output) — a `stop` rule. */
  maxTokens?: number;
  /** Hard tool-call ceiling — a `stop` rule. */
  maxToolCalls?: number;
  /** Hard wall-clock ceiling in ms — a `stop` rule. */
  maxDurationMs?: number;
  /** What to do when a `stop` rule fires. Defaults to `throw`. */
  onStop?: GuardStopBehavior;
  /** Clock injection point, for tests. */
  now?: () => number;
}

/**
 * Convenience preset that wires the common cost / token / tool-call / duration
 * ceilings into a {@link createGenAiGuard}. Returns the same {@link GenAiGuard}.
 */
export function createGenAiBudget(options: GenAiBudgetOptions): GenAiGuard {
  const rules: GenAiGuardRule[] = [];
  if (options.warnAtUsd !== undefined) {
    rules.push(costCeiling(options.warnAtUsd, 'warn'));
  }
  if (options.maxCostUsd !== undefined) {
    rules.push(costCeiling(options.maxCostUsd, 'stop'));
  }
  if (options.maxTokens !== undefined) {
    rules.push(tokenCeiling(options.maxTokens, 'stop'));
  }
  if (options.maxToolCalls !== undefined) {
    rules.push(maxToolCalls(options.maxToolCalls, 'stop'));
  }
  if (options.maxDurationMs !== undefined) {
    rules.push(maxDuration(options.maxDurationMs, 'stop'));
  }
  return createGenAiGuard({
    rules,
    onStop: options.onStop,
    now: options.now,
  });
}
