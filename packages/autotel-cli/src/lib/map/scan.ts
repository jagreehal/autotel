import * as path from 'node:path';
import { getAdapter } from './adapters';
import { buildFileFacts, createParser, type FileFacts } from './facts';
import { countSuppressed } from './exemptions';
import { collectProjectFacts, type ProjectFacts } from './project-facts';
import { getRule, runRules, unreadableResults } from './rules';
import {
  classifyRouteObservability,
  gradeFromScore,
  scoreGlobal,
  scoreRoute,
} from './score';
import { classifySensitivity } from './sensitivity';
import type {
  CheckId,
  CheckResult,
  Framework,
  MapFile,
  ProjectSuggestion,
  RawRouteEntry,
  RouteEntry,
  ScanResult,
  ScanSummary,
} from './types';

export interface ScanOptions {
  projectRoot: string;
  framework: Framework;
  /** Injected in tests; defaults to reading `package.json` under the root. */
  project?: ProjectFacts;
}

/** Stable identity for an entry point, so a baseline can match it across runs. */
export function routeId(route: RawRouteEntry): string {
  return `${route.method ?? '*'} ${route.path} (${route.file})`;
}

/** Find entry points for `framework`, run the rules against each, and score them. */
export function scan(options: ScanOptions): ScanResult {
  const { projectRoot, framework } = options;
  const parse = createParser();
  const project = options.project ?? collectProjectFacts(projectRoot);
  const adapter = getAdapter(framework);

  const warnings: string[] = [];
  const routes: RouteEntry[] = [];

  /* File-wide facts are shared by file-per-route entries. Handler-scoped facts
     remain per route so one router registration cannot vouch for a sibling. */
  const factsCache = new Map<string, FileFacts>();

  for (const raw of adapter.extractRoutes({ projectRoot, parse })) {
    const source = parse(path.join(projectRoot, raw.file));

    let facts: FileFacts | null = null;
    if (source) {
      const scope = adapter.scopesFor?.(raw, source);
      if (scope) {
        facts = buildFileFacts(source, scope);
      } else {
        const cached = factsCache.get(raw.file);
        facts = cached ?? buildFileFacts(source);
        if (!cached) factsCache.set(raw.file, facts);
      }
    }

    /* Sensitivity has to be resolved before the rules run: `audit` is gated on
       it, and `redaction` reads it too. */
    const sensitivity =
      facts !== null
        ? classifySensitivity(raw, facts)
        : { level: 'none' as const, reasons: [] };

    const target = { ...raw, sensitivity };
    const results =
      source !== null && facts !== null
        ? runRules({
            target,
            facts,
            project,
            autoImports: adapter.autoImports,
            source,
          })
        : unreadableResults(target);
    warnings.push(...results.warnings);

    routes.push({
      ...raw,
      id: routeId(raw),
      checks: results.checks,
      suggestions: results.suggestions,
      sensitivity,
      score: scoreRoute(results.checks),
    });
  }

  const suggestions = hoistProjectSuggestions(routes);
  const score = scoreGlobal(routes);

  const summary: ScanSummary = {
    instrumented: 0,
    partial: 0,
    dark: 0,
    exempt: 0,
    suppressedChecks: 0,
  };
  for (const route of routes) {
    summary[classifyRouteObservability(route)]++;
    summary.suppressedChecks += countSuppressed(route);
  }

  const map: MapFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    framework,
    projectName: project.name,
    score,
    routes,
  };

  return {
    map,
    grade: gradeFromScore(score),
    suggestions,
    /* Deduped: a file with twenty routes raises the same bad disable comment
       twenty times, and the reader has one comment to fix. */
    warnings: [...new Set(warnings)],
    summary,
  };
}

/**
 * Move project-scoped suggestions off the routes and into one list.
 *
 * Setting `attributeRedactor` is a single edit, so leaving a copy on every
 * entry point where PII is in play would make the report claim there are five
 * things to do. The first entry point that raised it keeps the evidence, which
 * is where the reader should look first.
 */
function hoistProjectSuggestions(
  routes: readonly RouteEntry[],
): ProjectSuggestion[] {
  const hoisted = new Map<CheckId, ProjectSuggestion>();

  for (const route of routes) {
    for (const [id, result] of Object.entries(route.suggestions) as [
      CheckId,
      CheckResult,
    ][]) {
      const rule = getRule(id);
      if (rule?.category !== 'opportunity' || rule.scope !== 'project')
        continue;
      delete route.suggestions[id];
      if (hoisted.has(id) || result.status !== 'fail') continue;
      hoisted.set(id, {
        id,
        message: result.message ?? rule.question,
        ...(result.evidence ? { evidence: result.evidence } : {}),
      });
    }
  }

  return [...hoisted.values()];
}
