import type { SourceFile } from 'ts-morph';
import {
  isAutotelModule,
  lineSnippet,
  usesAutotelApi as factsUseAutotelApi,
  type FileFacts,
} from './facts';
import {
  collectSuppressions,
  getRouteExemption,
  isSkipped,
  suppressionMessage,
  type Suppression,
} from './exemptions';
import type { ProjectFacts } from './project-facts';
import {
  HANDLER_KINDS,
  type CheckId,
  type CheckResult,
  type RawRouteEntry,
  type RouteKind,
  type Sensitivity,
} from './types';

/** The entry point a rule looks at, with its sensitivity already resolved. */
export interface RuleTarget extends RawRouteEntry {
  sensitivity: Sensitivity;
}

/** A gap a rule found. Returning `null` means the rule passed. */
export interface RuleReport {
  message: string;
  /** Defaults to the handler's line. */
  line?: number;
}

export interface RuleContext {
  target: RuleTarget;
  /** Facts for this entry point — the handler's subtree when one is known. */
  facts: FileFacts;
  project: ProjectFacts;
  /** Names the framework injects without an import, e.g. Nitro's `useLogger`. */
  autoImports: readonly string[];
  source: SourceFile;
}

interface BaseRule {
  id: CheckId;
  /** Column header in `--all`, kept short. */
  title: string;
  /** The question this rule answers, as a sentence. */
  question: string;
  appliesTo: {
    kinds: readonly RouteKind[];
    /**
     * Last word before the rule runs, for conditions only known after parsing.
     * Returning `false` reports the rule as not-applicable.
     */
    when?: (context: RuleContext) => boolean;
  };
  /** The code that would make this rule pass. */
  fix: (context: RuleContext) => string;
  check: (context: RuleContext) => RuleReport | null;
}

/** A rule whose failure is a real gap, and costs score points. */
export interface RequirementRule extends BaseRule {
  category: 'requirement';
  weight: number;
}

/**
 * A rule that suggests going further with something the project already has.
 *
 * Opportunities carry no weight — the type makes it impossible to give one, so
 * a suggestion can never quietly turn into a penalty.
 */
export interface OpportunityRule extends BaseRule {
  category: 'opportunity';
  /**
   * `entry-point` (the default) means each hit is its own edit. `project` means
   * the whole suggestion is one change, done once — reporting it per entry
   * point would claim there are five things to do when there is one.
   */
  scope?: 'entry-point' | 'project';
}

export type MapRule = RequirementRule | OpportunityRule;

/* -------------------------------------------------------------------------- */
/* Autotel API surface the rules look for                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything that puts this handler on a trace.
 *
 * The framework wrappers belong here alongside `trace()`: `withAutotel(...)`
 * from `autotel-adapters/next` creates the request span, and a rule that only
 * knew about `trace()` would report a fully instrumented route as invisible.
 */
const SPAN_WRAPPERS = [
  'trace',
  'span',
  'instrument',
  'withTracing',
  'enterSpan',
  'traceGenAI',
  'traceLLM',
  'withAutotel',
  'withAutotelFetch',
  'withAutotelHandler',
  'autotelHandle',
  'autotelMiddleware',
  'defineAutotelEventHandler',
];

const REQUEST_LOGGERS = ['getRequestLogger', 'useLogger', 'getExecutionLogger'];

/** Request-logger and span-context members that attach business context. */
const CONTEXT_MEMBERS = [
  'set',
  'setAttribute',
  'setAttributes',
  'info',
  'warn',
  'error',
];

const AUDIT_APIS = [
  'withAudit',
  'securityEvent',
  'withSecurity',
  'setAuditAttributes',
  'forceKeepAuditEvent',
];

const GENAI_TRACERS = ['traceGenAI', 'traceLLM', 'recordGenAiUsage'];

/** Calls that mean "an LLM was invoked", across the common SDKs. */
const LLM_CALLS = [
  'generateText',
  'streamText',
  'generateObject',
  'streamObject',
  'completions',
  'create',
  'invoke',
  'chat',
];

/**
 * Whether the file calls one of these autotel APIs.
 *
 * The name has to come from autotel — imported from an `autotel*` module, or
 * injected by the framework integration. Otherwise a local helper called
 * `trace()` would score as instrumentation.
 */
function usesAutotelApi(
  context: RuleContext,
  names: readonly string[],
): boolean {
  return factsUseAutotelApi(context.facts, names, context.autoImports);
}

function autotelLocalNames(
  context: RuleContext,
  canonicalNames: readonly string[],
): Set<string> {
  const locals = new Set(
    context.autoImports.filter((name) => canonicalNames.includes(name)),
  );
  for (const canonical of canonicalNames) locals.add(canonical);
  for (const [local, module] of context.facts.imports) {
    if (!isAutotelModule(module)) continue;
    const imported = context.facts.importedNames.get(local) ?? '';
    if (canonicalNames.includes(imported)) {
      locals.add(local);
    } else if (imported === '*') {
      for (const canonical of canonicalNames) {
        locals.add(`${local}.${canonical}`);
      }
    }
  }
  return locals;
}

function loggerMemberCalls(context: RuleContext, member: string) {
  const factories = autotelLocalNames(context, REQUEST_LOGGERS);
  return context.facts.memberCalls(member).filter((call) => {
    if (
      call.root &&
      factories.has(context.facts.factoryBindings.get(call.root) ?? '')
    ) {
      return true;
    }
    return [...factories].some((factory) =>
      call.text.startsWith(`${factory}().`),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Requirements                                                                */
/* -------------------------------------------------------------------------- */

const traceRule: RequirementRule = {
  id: 'trace',
  category: 'requirement',
  title: 'span',
  question: 'Does this entry point produce a span?',
  weight: 40,
  appliesTo: { kinds: HANDLER_KINDS },
  fix: ({ target }) =>
    `export const handler = trace('${target.method?.toLowerCase() ?? 'handle'} ${target.path}', async () => { /* … */ });`,
  check(context) {
    if (usesAutotelApi(context, SPAN_WRAPPERS)) return null;
    if (context.project.ambientTracing) return null;
    if (!context.project.hasAutotel) {
      return {
        message: 'autotel not installed — nothing observes this handler',
      };
    }
    return {
      message:
        'no trace() or span() — this handler is invisible when it breaks',
    };
  },
};

const contextRule: RequirementRule = {
  id: 'context',
  category: 'requirement',
  title: 'context',
  question: 'Does the span carry business context, or only method and status?',
  weight: 25,
  appliesTo: { kinds: HANDLER_KINDS },
  fix: ({ target }) =>
    target.framework === 'nitro'
      ? "const log = useLogger(event); log.set({ 'user.id': userId });"
      : "const log = getRequestLogger(); log.set({ 'user.id': userId });",
  check(context) {
    const hasLogger = usesAutotelApi(context, REQUEST_LOGGERS);
    const setsContext = CONTEXT_MEMBERS.some(
      (member) => loggerMemberCalls(context, member).length > 0,
    );
    if (hasLogger && setsContext) return null;
    if (hasLogger) {
      return {
        message: 'request logger acquired but never given attributes',
        line: context.facts.callsTo('getRequestLogger')[0]?.line,
      };
    }
    return {
      message: context.project.ambientTracing
        ? 'handler adds nothing to its request span — only method, path and status are recorded'
        : 'no request-scoped attributes — the span says what failed, not for whom',
    };
  },
};

const structuredErrorsRule: RequirementRule = {
  id: 'structured-errors',
  category: 'requirement',
  title: 'errors',
  question: 'Do thrown errors explain why they failed and how to fix them?',
  weight: 15,
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ facts }) => facts.throws.length > 0,
  },
  fix: () =>
    "throw createStructuredError({ message: 'Payment declined', why: '…', fix: '…', status: 402 });",
  check({ facts }) {
    const plain = facts.throws.find((entry) => entry.kind === 'plain-error');
    if (plain) {
      return {
        message: 'throws a bare Error — no why, fix, or status for the caller',
        line: plain.line,
      };
    }
    const incomplete = facts.throws.find(
      (entry) =>
        entry.kind === 'structured' &&
        (!entry.props.has('why') || !entry.props.has('fix')),
    );
    if (!incomplete) return null;
    const missing = ['why', 'fix'].filter(
      (name) => !incomplete.props.has(name),
    );
    return {
      message: `structured error is missing ${missing.join(' and ')}`,
      line: incomplete.line,
    };
  },
};

const pageErrorHandlingRule: RequirementRule = {
  id: 'page-error-handling',
  category: 'requirement',
  title: 'fetch',
  question: 'Does this page handle its data request failing?',
  weight: 20,
  appliesTo: {
    kinds: ['page'],
    when: ({ facts }) => facts.network.length > 0,
  },
  fix: () =>
    'try { const data = await fetchData(); } catch (error) { /* render an error state */ }',
  check({ facts }) {
    const unhandled = facts.network.find((call) => !call.handled);
    if (!unhandled) return null;
    return {
      message: `${unhandled.name}() has no error path — the page breaks when it fails`,
      line: unhandled.line,
    };
  },
};

const errorHandlingRule: RequirementRule = {
  id: 'error-handling',
  category: 'requirement',
  title: 'catch',
  question: 'Does every catch block record the failure?',
  weight: 10,
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ facts }) => facts.catches.length > 0,
  },
  fix: () => 'catch (error) { log.error(error); throw error; }',
  check({ facts }) {
    const swallowed = facts.catches.find(
      (entry) => entry.isEmpty || !entry.handled,
    );
    if (!swallowed) return null;
    return {
      message: swallowed.isEmpty
        ? 'empty catch block — the failure disappears'
        : 'catch block neither records nor rethrows — the failure disappears',
      line: swallowed.line,
    };
  },
};

const auditRule: RequirementRule = {
  id: 'audit',
  category: 'requirement',
  title: 'audit',
  question: 'Does this money or auth path leave an audit trail?',
  weight: 25,
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ target }) => target.sensitivity.level === 'high',
  },
  fix: ({ target }) =>
    `withAudit({ action: '${target.path.replaceAll('/', '.').replace(/^\./, '')}', resource: '…', actorId }, async (ctx, log) => { /* … */ });`,
  check(context) {
    if (usesAutotelApi(context, AUDIT_APIS)) return null;
    const reason = context.target.sensitivity.reasons[0] ?? 'sensitive route';
    return {
      message: `no audit trail (${reason}) — withAudit() survives tail sampling`,
    };
  },
};

const WRITE_CALLS = [
  'create',
  'update',
  'insert',
  'upsert',
  'delete',
  'destroy',
];

const auditCoverageRule: OpportunityRule = {
  id: 'audit-coverage',
  category: 'opportunity',
  title: 'audit+',
  question: 'Should this state change join the project audit trail?',
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ target, project, facts }) =>
      target.sensitivity.level !== 'high' &&
      project.hasAuditUsage &&
      WRITE_CALLS.some((name) => facts.memberCalls(name).length > 0),
  },
  fix: ({ target }) =>
    `securityEvent({ name: '${target.path.replaceAll('/', '.').replace(/^\./, '')}.changed', category: 'data', outcome: 'success' });`,
  check(context) {
    if (usesAutotelApi(context, AUDIT_APIS)) return null;
    const write = WRITE_CALLS.flatMap((name) =>
      context.facts.memberCalls(name),
    ).toSorted((a, b) => a.line - b.line)[0];
    return {
      message:
        'changes state with no security event — this project records audit signals elsewhere',
      line: write?.line,
    };
  },
};

const errorCatalogRule: OpportunityRule = {
  id: 'error-catalog',
  category: 'opportunity',
  title: 'catalog',
  question: 'Should duplicated structured errors become catalog entries?',
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ project, facts }) =>
      project.hasErrorCatalog &&
      facts.throws.some(
        (entry) =>
          entry.signature !== undefined &&
          project.repeatedErrors.has(entry.signature),
      ),
  },
  fix: () =>
    "const billing = defineErrorCatalog('billing', { PAYMENT_DECLINED: { status: 402, message: 'Card declined', why: '…', fix: '…' } });",
  check({ facts, project }) {
    const thrown = facts.throws.find(
      (entry) =>
        entry.signature !== undefined &&
        project.repeatedErrors.has(entry.signature),
    );
    if (!thrown?.signature) return null;
    const repeated = project.repeatedErrors.get(thrown.signature);
    if (!repeated) return null;
    return {
      message: `"${repeated.label}" is repeated in ${repeated.files.length} files — one error catalog entry would cover them`,
      line: thrown.line,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

const genaiRule: OpportunityRule = {
  id: 'genai',
  category: 'opportunity',
  title: 'genai',
  question: 'Are LLM calls traced with token usage and cost?',
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ project }) => project.hasLlmDependency,
  },
  fix: () =>
    "traceGenAI({ operation: 'chat', model }, async () => client.chat.completions.create(…));",
  check(context) {
    const llmCall = LLM_CALLS.flatMap((name) =>
      context.facts.memberCalls(name),
    ).find((call) => call.root !== null && call.root !== 'JSON');
    if (!llmCall) return null;
    if (usesAutotelApi(context, GENAI_TRACERS)) return null;
    return {
      message:
        'LLM call with no gen_ai.* span — token usage and cost go unrecorded',
      line: llmCall.line,
    };
  },
};

const validationRule: OpportunityRule = {
  id: 'validation',
  category: 'opportunity',
  title: 'input',
  question: 'Are rejected inputs visible in telemetry?',
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ project }) => project.hasZod,
  },
  fix: () =>
    "const parse = defineValidator('createOrder', schema, { boundary: 'http' });",
  check(context) {
    const parseCall =
      context.facts.memberCalls('parse')[0] ??
      context.facts.memberCalls('safeParse')[0];
    if (!parseCall) return null;
    if (usesAutotelApi(context, ['defineValidator'])) return null;
    return {
      message:
        'input validated without telemetry — defineValidator() records which field failed',
      line: parseCall.line,
    };
  },
};

const redactionRule: OpportunityRule = {
  id: 'redaction',
  category: 'opportunity',
  scope: 'project',
  title: 'pii',
  question: 'Is PII redacted before attributes leave the process?',
  appliesTo: {
    kinds: HANDLER_KINDS,
    when: ({ target, project }) =>
      target.sensitivity.level !== 'none' &&
      project.hasAutotel &&
      !project.hasRedaction,
  },
  fix: () => "init({ service, attributeRedactor: 'default' })",
  check(context) {
    return {
      message: `sensitive routes but init() sets no attributeRedactor${
        context.project.instrumentationFile
          ? ` (${context.project.instrumentationFile})`
          : ''
      }`,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every rule, in report order.
 *
 * Adding a rule is one entry here plus one id in {@link CheckId}: weight,
 * column title, docs link, and applicability all travel with the rule.
 */
export const RULES: readonly MapRule[] = [
  traceRule,
  contextRule,
  structuredErrorsRule,
  errorHandlingRule,
  pageErrorHandlingRule,
  auditRule,
  auditCoverageRule,
  errorCatalogRule,
  genaiRule,
  validationRule,
  redactionRule,
];

/**
 * The registry and the published {@link CheckId} union describe the same set of
 * rules. `autotel.map.json` is a public contract, so drift would silently
 * change what consumers receive — this fails the build instead of the release.
 */
type RegisteredId = (typeof RULES)[number]['id'];
const idsMatch: [CheckId] extends [RegisteredId] ? true : never = true;
void idsMatch;

const RULES_BY_ID = new Map<CheckId, MapRule>(
  RULES.map((rule) => [rule.id, rule]),
);

export function getRule(id: CheckId): MapRule | undefined {
  return RULES_BY_ID.get(id);
}

/** Rules that move the score, in report order. */
export const REQUIREMENTS: readonly RequirementRule[] = RULES.filter(
  (rule): rule is RequirementRule => rule.category === 'requirement',
);

export interface RuleResults {
  checks: Partial<Record<CheckId, CheckResult>>;
  suggestions: Partial<Record<CheckId, CheckResult>>;
  /** Problems with the file's own disable comments, e.g. a typo'd id. */
  warnings: string[];
}

/**
 * Run every applicable rule against one entry point.
 *
 * Rules that are irrelevant by kind are left out of the result entirely; rules
 * that are relevant but gated by `when` are reported as `n/a`, so the map
 * distinguishes "this question makes no sense here" from "this question does
 * not apply right now".
 */
export function runRules(context: RuleContext): RuleResults {
  const results: RuleResults = { checks: {}, suggestions: {}, warnings: [] };
  const { target } = context;
  /* Depends only on the route's path and file, so it holds even for a file we
     cannot read — an exempt health check stays exempt when it fails to parse. */
  const exemption = getRouteExemption(target);
  const relevant = RULES.filter((rule) =>
    rule.appliesTo.kinds.includes(target.kind),
  );

  const suppressions = collectSuppressions(context.source.getFullText());
  const knownIds = RULES.map((rule) => rule.id);
  for (const suppression of suppressions.unknown(knownIds)) {
    results.warnings.push(
      `${target.file}:${suppression.declaredAt} disables "${suppression.id}", which is not a check autotel map runs`,
    );
  }

  for (const rule of relevant) {
    const bucket =
      rule.category === 'requirement' ? results.checks : results.suggestions;

    if (exemption && isSkipped(exemption, rule.id)) {
      /* Only requirements record the excuse: an opportunity that does not apply
         is silence, and an `n/a` suggestion reads as advice to instrument the
         health check the map just excused. */
      if (rule.category === 'requirement') {
        results.checks[rule.id] = { status: 'n/a', message: exemption.reason };
      }
      continue;
    }

    if (rule.appliesTo.when && !rule.appliesTo.when(context)) {
      /* An opportunity that does not apply is silence, not a row in the report:
         "you could use a feature you don't use" is noise. */
      if (rule.category === 'requirement') {
        results.checks[rule.id] = { status: 'n/a' };
      }
      continue;
    }

    const report = rule.check(context);
    if (!report) {
      /* An opportunity with nothing to say is left out entirely. */
      if (rule.category === 'requirement') {
        results.checks[rule.id] = { status: 'pass' };
      }
      continue;
    }

    /* Directives are resolved once a rule has something to say, rather than
       before it runs: a disabled check is a failure the author chose not to
       see, so a rule that would have passed still reports as passing. That
       keeps the count of disabled checks equal to the findings actually
       waived. */
    const line = report.line ?? target.handler?.line ?? 1;
    const disabled =
      suppressions.file(rule.id) ?? suppressions.at(rule.id, line);
    if (disabled) {
      if (rule.category === 'requirement') {
        results.checks[rule.id] = suppressedResult(disabled, target.file);
      }
      continue;
    }

    bucket[rule.id] = {
      status: 'fail',
      message: report.message,
      fix: rule.fix(context),
      evidence: {
        file: target.file,
        line,
        snippet: lineSnippet(context.source, line),
      },
    };
  }

  return results;
}

/**
 * Results for an entry point whose file could not be read or parsed.
 *
 * A file that will not parse is a real failure, but only of requirements —
 * there is no basis to suggest anything about code that could not be read.
 */
export function unreadableResults(target: RuleTarget): RuleResults {
  const results: RuleResults = { checks: {}, suggestions: {}, warnings: [] };
  const exemption = getRouteExemption(target);

  for (const rule of RULES) {
    if (rule.category !== 'requirement') continue;
    if (!rule.appliesTo.kinds.includes(target.kind)) continue;
    results.checks[rule.id] =
      exemption && isSkipped(exemption, rule.id)
        ? { status: 'n/a', message: exemption.reason }
        : {
            status: 'fail',
            message: 'file could not be parsed',
            evidence: { file: target.file, line: 1 },
          };
  }

  return results;
}

/**
 * A finding the author waived with a comment.
 *
 * `n/a` rather than `pass`: the rule did find something, and calling that a
 * pass would read as coverage the entry point does not have.
 */
function suppressedResult(suppression: Suppression, file: string): CheckResult {
  return {
    status: 'n/a',
    suppressed: true,
    message: suppressionMessage(suppression),
    evidence: { file, line: suppression.declaredAt },
  };
}
