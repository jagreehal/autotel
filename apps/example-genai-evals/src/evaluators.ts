/**
 * Three evaluators, none of which needs a model.
 *
 * An LLM judge is the expensive option, so reach for it after the cheap checks
 * have had their say. A heuristic that runs on every response beats a judge you
 * sample at 5% because of the bill.
 */

export interface Answer {
  question: string;
  text: string;
  /** Source ids the retrieval step returned for this question. */
  retrieved: string[];
  /** Source ids the answer actually cited. */
  cited: string[];
}

export interface Verdict {
  /** Evaluator name, becomes `gen_ai.evaluation.name`. */
  name: string;
  /** 0..1, becomes `gen_ai.evaluation.score.value`. */
  score: number;
  /** `pass` or `fail`, becomes `gen_ai.evaluation.score.label`. */
  label: 'pass' | 'fail';
  /** Why it failed, becomes `gen_ai.evaluation.explanation`. */
  explanation?: string;
}

const MAX_CHARS = 600;

/**
 * Length. A wall of text is a bad answer even when every word is true, and the
 * check costs nothing.
 */
export function brevity(answer: Answer): Verdict {
  const over = answer.text.length > MAX_CHARS;
  return {
    name: 'brevity',
    score: over ? 0 : 1,
    label: over ? 'fail' : 'pass',
    explanation: over
      ? `${answer.text.length} characters, over the ${MAX_CHARS} limit`
      : undefined,
  };
}

/**
 * Groundedness. Every citation must appear in what retrieval returned. A
 * citation the retriever never produced is the agent inventing a source.
 */
export function groundedness(answer: Answer): Verdict {
  const retrieved = new Set(answer.retrieved);
  const invented = answer.cited.filter((id) => !retrieved.has(id));
  const uncited = answer.cited.length === 0;

  if (uncited) {
    return {
      name: 'groundedness',
      score: 0,
      label: 'fail',
      explanation: 'answer cited no source',
    };
  }

  const score = 1 - invented.length / answer.cited.length;
  return {
    name: 'groundedness',
    score,
    label: invented.length === 0 ? 'pass' : 'fail',
    explanation:
      invented.length > 0
        ? `cited ${invented.join(', ')}, which retrieval never returned`
        : undefined,
  };
}

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (your|the) (system )?prompt/i,
  /reveal (your|the) (system )?prompt/i,
  /you are now (?:a|an|in) /i,
  /print (your|the) (instructions|rules|configuration)/i,
];

/**
 * Prompt injection. Scores the question, not the answer: an attempt that the
 * agent shrugged off is still worth knowing about, and a spike in attempts is
 * the signal you want to alert on.
 */
export function promptInjection(answer: Answer): Verdict {
  const hit = INJECTION_PATTERNS.find((pattern) =>
    pattern.test(answer.question),
  );
  return {
    name: 'prompt_injection',
    score: hit ? 0 : 1,
    label: hit ? 'fail' : 'pass',
    explanation: hit ? `question matched ${hit.source}` : undefined,
  };
}

export const EVALUATORS = [brevity, groundedness, promptInjection] as const;

/** Run every evaluator over one answer. */
export function evaluate(answer: Answer): Verdict[] {
  return EVALUATORS.map((evaluator) => evaluator(answer));
}
