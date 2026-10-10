/**
 * Typed model judgments on finished requests ("signals"). Experimental: it
 * rides the AI SDK's `experimental_evaluate` model contract.
 *
 * A signal is a question about a request, answered by an evaluation model as a
 * typed value with a confidence: `signals.fault.value = 'upstream'`,
 * `signals.fault.confidence = 0.93`. You can group by it, alert on it, and use
 * it to keep requests that tail sampling would have dropped.
 *
 * You bring the model: autotel picks no provider and reads no key.
 *
 * Where answers land. A span is immutable once ended, and a model call is
 * async, so a fresh answer cannot be written onto the request span before the
 * span leaves the pipeline. Answers therefore go on a `signals {span name}`
 * child span in the same trace, which also parents the model call. Answers
 * served from `cacheKey` are synchronous and go straight onto the request span.
 *
 * Keep. Tail sampling is decided per span when the span ends. A cached answer
 * whose `keep` holds marks the request span kept before tail sampling sees it.
 * A fresh answer arrives too late for that: the request span and its children
 * may already be dropped. The signals span is never dropped, so when `keep`
 * holds on a dropped request it carries the request's (redacted) attributes
 * under `signals.event.*`, the closest thing to keeping the event.
 *
 * @example
 * ```ts
 * import { init } from 'autotel';
 * import { createSignals, defineSignal } from 'autotel-genai/signals';
 *
 * const fault = defineSignal({
 *   name: 'fault',
 *   when: (e) => (e.status ?? 0) >= 500,
 *   ask: 'Who is responsible for this failure?',
 *   choice: { client: 'Bad input', app: 'Our own code', upstream: 'A dependency failed' },
 * });
 *
 * init({ service: 'api', spanEnrichers: [createSignals({ model, signals: [fault] })] });
 * ```
 */

import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type AttributeValue,
  type Context,
} from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  createAttributeRedactor,
  type AttributeRedactorConfig,
  type AttributeRedactorPreset,
} from 'autotel';
import {
  wrapEvaluationModel,
  type AiSdkEvaluationAnswer,
  type AiSdkEvaluationModel,
  type AiSdkEvaluationResult,
  type WrapEvaluationModelOptions,
} from './ai-sdk-evaluate.js';

/** What a signal sees: the request span's attributes plus a few typed fields. */
export interface SignalInput extends Record<string, unknown> {
  /** Span name, e.g. `POST /api/checkout`. */
  name: string;
  /** `http.response.status_code` when present. */
  status?: number;
  /** True when the span ended with an error status. */
  error: boolean;
  durationMs: number;
}

/** Answer to a yes/no question. `confidence` is the probability of `value`. */
export interface BooleanVerdict {
  value: boolean;
  confidence: number;
}

/** Answer to a pick-one question; `confidence` when the model returns a distribution. */
export interface ChoiceVerdict<TOption extends string = string> {
  value: TOption;
  confidence?: number;
}

/** Answer to a rubric question; `score` is the weighted position between levels. */
export interface ScoreVerdict<TLevel extends string = string> {
  value: TLevel;
  score: number;
  confidence?: number;
}

export type Verdict = BooleanVerdict | ChoiceVerdict | ScoreVerdict;

/** The question shape the evaluation model receives. */
export type SignalQuestion =
  | {
      type: 'boolean';
      instructions: string;
      criteria?: { true?: string; false?: string };
    }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: readonly string[] };

interface SignalBase<TVerdict extends Verdict> {
  /** Attribute name under `signals.`: letters, digits, `_` and `-`. */
  name: string;
  /** Cheap predicate; no model call when it returns false. Required with `keep`. */
  when?: (event: SignalInput) => boolean;
  /** The question, in plain English. */
  ask: string;
  /** Keep the request past tail sampling when it returns true. Promote only. */
  keep?: (verdict: TVerdict) => boolean;
  /** Reuse a verdict across requests with the same key. `undefined` skips the cache. */
  cacheKey?: (event: SignalInput) => string | undefined;
}

export interface BooleanSignalInput extends SignalBase<BooleanVerdict> {
  criteria?: { true?: string; false?: string };
}

export interface ChoiceSignalInput<TOption extends string> extends SignalBase<
  ChoiceVerdict<TOption>
> {
  /** Options, each with the description the model matches against. */
  choice: Record<TOption, string>;
}

export interface ScoreSignalInput<TLevel extends string> extends SignalBase<
  ScoreVerdict<TLevel>
> {
  /** Ordered levels, lowest first. */
  score: readonly [TLevel, TLevel, ...TLevel[]];
}

/** A validated signal. Create with {@link defineSignal}. */
export interface Signal {
  name: string;
  question: SignalQuestion;
  when?: (event: SignalInput) => boolean;
  keep?: (verdict: Verdict) => boolean;
  cacheKey?: (event: SignalInput) => string | undefined;
}

export interface DefineSignal {
  <TOption extends string>(signal: ChoiceSignalInput<TOption>): Signal;
  <TLevel extends string>(signal: ScoreSignalInput<TLevel>): Signal;
  (signal: BooleanSignalInput): Signal;
}

const NAME_PATTERN = /^[a-z][\w-]*$/i;

/**
 * Declare a signal. `ask` alone is yes/no, `ask` + `choice` picks one option,
 * `ask` + `score` places the request on a rubric.
 */
export const defineSignal: DefineSignal = (
  signal:
    BooleanSignalInput | ChoiceSignalInput<string> | ScoreSignalInput<string>,
): Signal => {
  const fail = (why: string) => {
    throw new Error(`[autotel-genai/signals] signal "${signal.name}" ${why}`);
  };
  if (!NAME_PATTERN.test(signal.name))
    fail('has an invalid name: use letters, digits, _ and -');
  if (!signal.ask.trim()) fail('has an empty ask');
  // A keep signal with no predicate would put a model call on every request.
  if (signal.keep && !signal.when) fail('has keep without when');

  let question: SignalQuestion;
  if ('choice' in signal) {
    if (Object.keys(signal.choice).length < 2)
      fail('needs at least two options in choice');
    question = {
      type: 'choice',
      instructions: signal.ask,
      criteria: signal.choice,
    };
  } else if ('score' in signal) {
    if (signal.score.length < 2) fail('needs at least two levels in score');
    question = {
      type: 'score',
      instructions: signal.ask,
      criteria: signal.score,
    };
  } else {
    question = {
      type: 'boolean',
      instructions: signal.ask,
      criteria: signal.criteria,
    };
  }
  return {
    name: signal.name,
    question,
    when: signal.when,
    // SAFETY: defineSignal's overloads tie each keep to its own verdict shape,
    // and toVerdict builds that shape from the signal's own question type.
    keep: signal.keep as Signal['keep'],
    cacheKey: signal.cacheKey,
  };
};

/** False for a `choice` answer naming an option the signal does not offer. */
function offered(signal: Signal, answer: AiSdkEvaluationAnswer): boolean {
  return (
    answer.type !== 'choice' ||
    signal.question.type !== 'choice' ||
    Object.hasOwn(signal.question.criteria, answer.choice)
  );
}

/** Map a model answer to a verdict for the signal that asked it. */
export function toVerdict(
  signal: Signal,
  answer: AiSdkEvaluationAnswer,
): Verdict {
  switch (answer.type) {
    case 'boolean': {
      const value = answer.probability >= 0.5;
      return {
        value,
        confidence: value ? answer.probability : 1 - answer.probability,
      };
    }
    case 'choice': {
      const confidence = answer.probabilities?.[answer.choice];
      return confidence === undefined
        ? { value: answer.choice }
        : { value: answer.choice, confidence };
    }
    case 'score': {
      const levels =
        signal.question.type === 'score' ? signal.question.criteria : [];
      let index = Math.round(answer.score);
      let confidence: number | undefined;
      for (const [key, p] of Object.entries(answer.probabilities ?? {})) {
        if (confidence === undefined || p > confidence) {
          confidence = p;
          index = Number(key);
        }
      }
      const value =
        levels[Math.min(levels.length - 1, Math.max(0, index))] ?? '';
      return confidence === undefined
        ? { value, score: answer.score }
        : { value, score: answer.score, confidence };
    }
  }
}

export interface SignalsOptions {
  /** AI SDK evaluation model (`EvaluationModelV4`). Required: there is no default. */
  model: AiSdkEvaluationModel;
  signals: Signal[];
  /** Model calls per minute across all signals; over budget, requests go unjudged. */
  budget?: {
    /** @default 600 */
    perMinute?: number;
    /** Pause after a failed call, in milliseconds. @default 30000 */
    cooldownMs?: number;
  };
  /** Per-call timeout in milliseconds. @default 2000 */
  timeoutMs?: number;
  /** Verdicts kept for `cacheKey` reuse. @default 1000 */
  cacheSize?: number;
  /**
   * What the model reads. Defaults to the request's attributes after redaction,
   * minus `autotel.*` internals. Pick fields to bound tokens and what leaves
   * the process.
   */
  state?: (event: SignalInput) => Record<string, unknown> | string;
  /** Larger states (JSON characters) are skipped. @default 100000 */
  maxStateChars?: number;
  /**
   * Redaction applied to attributes before they reach the model. Request spans
   * reach this processor before the export pipeline's redactor runs, so this is
   * the only redaction the model's input gets. `false` sends them as they are.
   * @default 'default'
   */
  redact?: AttributeRedactorConfig | AttributeRedactorPreset | false;
  /** Passed to {@link wrapEvaluationModel} for the model call's span. */
  evaluation?: WrapEvaluationModelOptions;
}

export interface SignalsStats {
  /** Model calls made. */
  calls: number;
  /** Requests with due signals left unjudged: budget, breaker or state size. */
  skipped: number;
  /** Model calls that failed or timed out. */
  errors: number;
  /** Verdicts served from `cacheKey`. */
  cached: number;
  /** Requests kept by a signal. */
  kept: number;
}

export interface SignalsProcessor extends SpanProcessor {
  stats(): SignalsStats;
}

const TRACER = 'autotel-genai/signals';

function durationMs(span: ReadableSpan): number {
  const [s, ns] = span.duration;
  return s * 1000 + ns / 1e6;
}

function verdictAttributes(
  name: string,
  verdict: Verdict,
  kept: boolean,
): Attributes {
  const attrs: Attributes = { [`signals.${name}.value`]: verdict.value };
  if (verdict.confidence !== undefined)
    attrs[`signals.${name}.confidence`] = verdict.confidence;
  if ('score' in verdict) attrs[`signals.${name}.score`] = verdict.score;
  if (kept) attrs[`signals.${name}.kept`] = true;
  return attrs;
}

/**
 * A span processor that judges finished request spans. Register it with
 * `init({ spanEnrichers: [createSignals(...)] })` so it runs before tail
 * sampling and export. All signals due for one request go into one call.
 * Any failure, timeout or exhausted budget leaves the request as it was.
 */
export function createSignals(options: SignalsOptions): SignalsProcessor {
  const names = new Set<string>();
  for (const signal of options.signals) {
    if (names.has(signal.name))
      throw new Error(
        `[autotel-genai/signals] duplicate signal name "${signal.name}"`,
      );
    names.add(signal.name);
  }

  const model = wrapEvaluationModel(options.model, options.evaluation);
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxStateChars = options.maxStateChars ?? 100_000;
  const perMinute = options.budget?.perMinute ?? 600;
  const cooldownMs = options.budget?.cooldownMs ?? 30_000;
  const cacheSize = options.cacheSize ?? 1000;
  const redact =
    options.redact === false
      ? undefined
      : createAttributeRedactor(options.redact ?? 'default');

  const cache = new Map<string, Verdict>();
  const pending = new Set<Promise<void>>();
  const stats: SignalsStats = {
    calls: 0,
    skipped: 0,
    errors: 0,
    cached: 0,
    kept: 0,
  };
  let windowStart = Date.now();
  let used = 0;
  let pausedUntil = 0;

  function takeBudget(): boolean {
    const now = Date.now();
    if (now < pausedUntil) return false;
    if (now - windowStart >= 60_000) {
      windowStart = now;
      used = 0;
    }
    if (used >= perMinute) return false;
    used++;
    return true;
  }

  function remember(key: string, verdict: Verdict): void {
    cache.delete(key);
    cache.set(key, verdict);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
  }

  function inputFor(span: ReadableSpan): {
    event: SignalInput;
    attributes: Attributes;
  } {
    const attributes: Attributes = {};
    for (const [key, value] of Object.entries(span.attributes)) {
      if (key.startsWith('autotel.') || key.startsWith('signals.')) continue;
      if (value === undefined) continue;
      attributes[key] = redact ? (redact(key, value) as AttributeValue) : value;
    }
    const status = span.attributes['http.response.status_code'];
    const event: SignalInput = {
      ...attributes,
      name: span.name,
      error: span.status.code === SpanStatusCode.ERROR,
      durationMs: durationMs(span),
      ...(typeof status === 'number' ? { status } : {}),
    };
    return { event, attributes };
  }

  async function judge(
    root: ReadableSpan,
    event: SignalInput,
    attributes: Attributes,
    due: Signal[],
    dropped: boolean,
    counted: boolean,
  ): Promise<void> {
    const raw = options.state ? options.state(event) : event;
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (json.length > maxStateChars || !takeBudget()) {
      stats.skipped++;
      return;
    }

    const parent = trace.setSpanContext(context.active(), root.spanContext());
    const span = trace
      .getTracer(TRACER)
      .startSpan(`signals ${root.name}`, {}, parent);
    const questions = Object.fromEntries(
      due.map((signal) => [signal.name, signal.question]),
    );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`signals timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      const call = context.with(trace.setSpan(parent, span), () =>
        model.doEvaluate({
          state: typeof raw === 'string' ? raw : JSON.parse(json),
          questions,
          abortSignal: controller.signal,
        } as never),
      );
      const result: AiSdkEvaluationResult = await Promise.race([call, timeout]);
      stats.calls++;

      let keep = false;
      for (const signal of due) {
        const answer = result.answers[signal.name];
        if (!answer || !offered(signal, answer)) continue;
        const verdict = toVerdict(signal, answer);
        const key = attempt(() => signal.cacheKey?.(event));
        if (key !== undefined) remember(`${signal.name}\0${key}`, verdict);
        const kept = attempt(() => signal.keep?.(verdict)) === true;
        keep ||= kept;
        span.setAttributes(verdictAttributes(signal.name, verdict, kept));
      }
      if (result.response?.modelId)
        span.setAttribute('signals.model', result.response.modelId);
      if (keep) {
        if (!counted) stats.kept++;
        // The request span left the pipeline before the answer came back.
        // When tail sampling dropped it, carry what the model judged.
        if (dropped) {
          span.setAttribute('signals.event.dropped', true);
          for (const [key, value] of Object.entries(attributes)) {
            if (value !== undefined)
              span.setAttribute(`signals.event.${key}`, value);
          }
        }
      }
    } catch (error) {
      stats.errors++;
      pausedUntil = Date.now() + cooldownMs;
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
      span.end();
    }
  }

  return {
    stats: () => ({ ...stats }),

    onStart(_span: Span, _context: Context): void {},

    onEnd(span: ReadableSpan): void {
      // User callbacks (`when`, `cacheKey`, `keep`) run here, inside the
      // app's own span.end(), which does not catch processor errors.
      try {
        consider(span);
      } catch {
        stats.errors++;
      }
    },

    forceFlush: drain,
    shutdown: drain,
  };

  // Requests that end while it waits start calls of their own, so it loops
  // until none are left.
  async function drain(): Promise<void> {
    while (pending.size > 0) await Promise.all(pending);
  }

  /** A user callback inside judge: one that throws skips its signal only. */
  function attempt<T>(callback: () => T): T | undefined {
    try {
      return callback();
    } catch {
      stats.errors++;
      return undefined;
    }
  }

  function consider(span: ReadableSpan): void {
    // A request is a local root: no parent, or a parent in another process.
    const parent = span.parentSpanContext;
    if (parent && !parent.isRemote) return;

    const { event, attributes } = inputFor(span);
    const due = options.signals.filter((s) => !s.when || s.when(event));
    if (due.length === 0) return;

    // Cached verdicts are known now, so they go on the request span itself,
    // before tail sampling reads it. Same mutation the other enrichers use.
    const written = span.attributes as Attributes;
    const toAsk: Signal[] = [];
    let counted = false;
    for (const signal of due) {
      const key = signal.cacheKey?.(event);
      const hit =
        key === undefined ? undefined : cache.get(`${signal.name}\0${key}`);
      if (!hit) {
        toAsk.push(signal);
        continue;
      }
      stats.cached++;
      const kept = signal.keep?.(hit) === true;
      Object.assign(written, verdictAttributes(signal.name, hit, kept));
      if (kept) {
        if (!counted) stats.kept++;
        counted = true;
        written[AUTOTEL_SAMPLING_TAIL_EVALUATED] = true;
        written[AUTOTEL_SAMPLING_TAIL_KEEP] = true;
      }
    }
    if (toAsk.length === 0) return;

    const dropped =
      written[AUTOTEL_SAMPLING_TAIL_EVALUATED] === true &&
      written[AUTOTEL_SAMPLING_TAIL_KEEP] === false;
    // Caught here, not in judge: a `state` projection that throws, or state
    // JSON.stringify rejects (a BigInt, a cycle), fails before judge's own
    // try, and the detached cleanup below would reject unhandled.
    const job = judge(span, event, attributes, toAsk, dropped, counted).catch(
      () => {
        stats.errors++;
      },
    );
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
}

/**
 * An evaluation model that answers from a function instead of a provider, for
 * tests and playgrounds without a key. `calls` records every request.
 */
export function scriptedEvaluationModel(
  answer: (
    name: string,
    question: SignalQuestion,
    state: unknown,
  ) => AiSdkEvaluationAnswer,
  modelId = 'scripted',
): AiSdkEvaluationModel & {
  calls: Array<{ state: unknown; questions: Record<string, SignalQuestion> }>;
} {
  const calls: Array<{
    state: unknown;
    questions: Record<string, SignalQuestion>;
  }> = [];
  return {
    provider: 'scripted',
    modelId,
    calls,
    doEvaluate(request: never) {
      const { state, questions } = request as {
        state: unknown;
        questions: Record<string, SignalQuestion>;
      };
      calls.push({ state, questions });
      const answers: Record<string, AiSdkEvaluationAnswer> = {};
      for (const [name, question] of Object.entries(questions))
        answers[name] = answer(name, question, state);
      return Promise.resolve({ answers, response: { modelId } });
    },
  };
}
