/**
 * What this project's telemetry can and cannot see.
 *
 * `doctor` already answers "is autotel wired up correctly". This answers the
 * question that decides whether a trace is evidence: which capture surfaces
 * does the installed toolchain observe at all? A trace showing no tool calls
 * looks the same whether none happened or none were capturable, and only the
 * second reading is a reason to distrust the record.
 *
 * Static assessment from declared dependencies — it never runs the app, so it
 * reports what is *possible*, not what a given run captured.
 */

import type { Check } from '../types/check';

/**
 * Mirrors `CAPTURE_SURFACES` in `autotel/evidence`, duplicated because the CLI
 * does not depend on the runtime package. Keep the two lists in step.
 */
export const CAPTURE_SURFACES = [
  'llm_calls',
  'tool_calls',
  'user_prompts',
  'file_io',
  'subprocess',
  'network',
  'ide_context',
] as const;

export type CaptureSurface = (typeof CAPTURE_SURFACES)[number];

export interface CaptureCoverage {
  observed: CaptureSurface[];
  unobserved: CaptureSurface[];
}

type Deps = Record<string, string | undefined>;

/**
 * Which dependency makes each surface observable. A surface with no rule is
 * unobservable by anything in the toolchain — `subprocess` and `ide_context`
 * are there deliberately, and reporting them is the most useful line this check
 * produces. Adding a rule here is how a surface stops being reported as a blind
 * spot, so an omission understates coverage rather than overstating it.
 */
const OBSERVED_BY: Partial<Record<CaptureSurface, readonly string[]>> = {
  llm_calls: ['autotel-genai'],
  tool_calls: ['autotel-genai', 'autotel-mcp-instrumentation'],
  user_prompts: ['autotel-agents'],
  // `auto-instrumentations-node` bundles `instrumentation-fs`, so a project
  // with either can see file reads and writes.
  file_io: [
    '@opentelemetry/instrumentation-fs',
    '@opentelemetry/auto-instrumentations-node',
  ],
  network: [
    '@opentelemetry/instrumentation-http',
    '@opentelemetry/instrumentation-undici',
    '@opentelemetry/auto-instrumentations-node',
  ],
};

export function assessCaptureCoverage(deps: Deps): CaptureCoverage {
  const observed: CaptureSurface[] = [];
  const unobserved: CaptureSurface[] = [];

  for (const surface of CAPTURE_SURFACES) {
    const sources = OBSERVED_BY[surface] ?? [];
    if (sources.some((pkg) => deps[pkg] !== undefined)) {
      observed.push(surface);
    } else {
      unobserved.push(surface);
    }
  }

  return { observed, unobserved };
}

const NO_SOURCE = 'nothing in the autotel toolchain observes this';

function sourceHint(surface: CaptureSurface): string {
  const sources = OBSERVED_BY[surface];
  return sources ? `install one of: ${sources.join(', ')}` : NO_SOURCE;
}

/** One check per surface, for `autotel doctor --capture`. */
export function captureCoverageChecks(deps: Deps): Check[] {
  const { observed, unobserved } = assessCaptureCoverage(deps);

  return [
    ...observed.map((surface): Check => ({
      id: `capture-${surface}`,
      title: `Capture: ${surface}`,
      level: 'info',
      status: 'ok',
      message: `${surface} is observable`,
    })),
    ...unobserved.map((surface): Check => ({
      id: `capture-${surface}`,
      title: `Capture: ${surface}`,
      level: 'info',
      status: 'warn',
      informational: true,
      message: `traces cannot show ${surface} — its absence proves nothing`,
      details: [
        sourceHint(surface),
        'Declare the gap on your spans with captureCoverageAttributes() from autotel/evidence',
      ],
    })),
  ];
}
