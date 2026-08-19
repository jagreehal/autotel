import type { MapOptions } from '../types/index';
import {
  detectFramework,
  isFramework,
  SUPPORTED_FRAMEWORKS,
} from '../lib/map/adapters';
import {
  compareToBaseline,
  hasRegressed,
  loadBaseline,
  MAP_FILE_NAME,
  writeMapFile,
  type BaselineComparison,
} from '../lib/map/baseline';
import { collectProjectFacts } from '../lib/map/project-facts';
import {
  findEntry,
  formatBaseline,
  formatEntryNotFound,
  formatGate,
  formatInspect,
  formatMatrix,
  formatReport,
  formatWarnings,
} from '../lib/map/report';
import { scan } from '../lib/map/scan';
import type { Framework, ScanResult } from '../lib/map/types';
import { AutotelError, AutotelErrorCodes } from '../lib/errors';
import { configureJsonOutput, printJson } from '../lib/json-output';
import { discoverProject } from '../lib/project';

export interface MapResult {
  projectRoot: string;
  framework: Framework;
  frameworkWarnings: string[];
  scan: ScanResult;
  /** Where `autotel.map.json` was written, or `null` with `--no-write`. */
  mapPath: string | null;
  /** Diff against the committed map, when `--baseline` was passed. */
  baseline: BaselineComparison | null;
}

/**
 * Read `--min-score`, rejecting anything that is not a whole 0-100.
 *
 * The whole string has to parse: `parseInt` reads `80oops` as 80 and `abc` as
 * nothing at all, and a threshold that quietly becomes `undefined` turns the
 * gate off — CI then reports success for a bar it never checked.
 */
function parseMinScore(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const threshold = Number(value);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_FLAG,
      message: `--min-score expects a whole number from 0 to 100, got "${value}"`,
      fix: 'Pass e.g. --min-score 70',
    });
  }
  return threshold;
}

/** What resolveFramework() answers with. */
interface ResolveFrameworkResult {
  framework: Framework;
  warnings: string[];
}

function resolveFramework(
  requested: string | undefined,
  projectRoot: string,
  deps: ReadonlySet<string>,
): ResolveFrameworkResult {
  if (requested !== undefined && requested !== '') {
    if (!isFramework(requested)) {
      throw new AutotelError({
        type: 'validation',
        code: AutotelErrorCodes.E_INVALID_FLAG,
        message: `Unknown framework "${requested}"`,
        fix: `Use one of: ${SUPPORTED_FRAMEWORKS.join(', ')}`,
        expected: { frameworks: [...SUPPORTED_FRAMEWORKS] },
      });
    }
    return { framework: requested, warnings: [] };
  }

  const detected = detectFramework(projectRoot, deps);
  if (!detected.framework) {
    throw new AutotelError({
      type: 'environment',
      code: AutotelErrorCodes.E_INVALID_INPUT,
      message: 'Could not detect a supported framework in this project',
      fix: `Pass --framework <name>. Supported: ${SUPPORTED_FRAMEWORKS.join(', ')}`,
      expected: { frameworks: [...SUPPORTED_FRAMEWORKS] },
    });
  }
  return { framework: detected.framework, warnings: detected.warnings };
}

/**
 * Scan the project for entry points and score their observability.
 *
 * Pure with respect to the filesystem except for the `autotel.map.json` write.
 */
export function runMapScan(options: MapOptions): MapResult {
  const project = discoverProject(options.cwd);
  if (!project) {
    throw new AutotelError({
      type: 'environment',
      code: AutotelErrorCodes.E_NO_PACKAGE_JSON,
      message: `No package.json found from ${options.cwd}`,
      fix: 'Run autotel map from inside a package, or pass --cwd <path>.',
    });
  }

  const projectRoot = options.workspaceRoot
    ? (project.workspace.workspaceRoot ?? project.packageRoot)
    : project.packageRoot;

  const facts = collectProjectFacts(projectRoot);
  const { framework, warnings } = resolveFramework(
    options.framework,
    projectRoot,
    facts.deps,
  );

  /* Read before the scan writes: writeMapFile overwrites autotel.map.json in
     place, so loading the baseline afterwards would compare this run against
     itself and never report a regression. */
  const baselineMap = options.baseline
    ? loadBaseline(
        projectRoot,
        typeof options.baseline === 'string' ? options.baseline : undefined,
      )
    : null;

  const result = scan({ projectRoot, framework, project: facts });

  const baseline = baselineMap
    ? compareToBaseline(baselineMap.map, result.map, baselineMap.source)
    : null;

  /* A run that just reported a regression must not overwrite the file it
     compared against: that moves the ratchet down to the worse state, and the
     same command run a second time reports no regression and exits 0. */
  const wouldClobberBaseline = baseline !== null && hasRegressed(baseline);

  const mapPath =
    options.write && !wouldClobberBaseline
      ? writeMapFile(projectRoot, result.map)
      : null;

  return {
    projectRoot,
    framework,
    frameworkWarnings: warnings,
    scan: result,
    mapPath,
    baseline,
  };
}

/**
 * Pick the view for the flags that were passed.
 *
 * The three views answer three different questions — "how am I doing", "show
 * me everything", "explain this one file" — so they are separate renderers
 * rather than one renderer with three modes.
 */
export function formatMapResult(
  result: MapResult,
  options: { all?: boolean; entry?: string; minScore?: number },
): string {
  const sections: string[] = [];

  /* Framework detection and disable-comment problems share one channel: both
     mean "the numbers below were produced under an assumption you should see",
     and both have to appear above every view. */
  const warnings = [...result.frameworkWarnings, ...result.scan.warnings];
  if (warnings.length > 0) sections.push(formatWarnings(warnings));

  if (options.entry) {
    const route = findEntry(result.scan, options.entry);
    sections.push(
      route
        ? formatInspect(route)
        : formatEntryNotFound(result.scan, options.entry),
    );
  } else if (options.all) {
    sections.push(formatMatrix(result.scan));
  } else {
    sections.push(formatReport(result.scan, { mapPath: result.mapPath }));
  }

  if (result.baseline) sections.push(formatBaseline(result.baseline));
  if (options.minScore !== undefined) {
    sections.push(formatGate(result.scan.map.score, options.minScore));
  }

  return sections.join('\n');
}

/** `autotel map` — static observability map of every entry point. */
export function runMap(options: MapOptions): void {
  configureJsonOutput({
    ...(options.outputFile !== undefined
      ? { outputFile: options.outputFile }
      : {}),
    outputRoot: options.cwd,
  });

  /* Before the scan, not after: an unusable threshold should cost nothing, and
     validating it afterwards means reading the whole project and writing
     autotel.map.json before admitting it cannot gate on the result. */
  const minScore = parseMinScore(options.minScore);
  const result = runMapScan(options);

  if (options.json) {
    printJson({
      ok: true,
      command: 'map',
      mapFile: MAP_FILE_NAME,
      mapPath: result.mapPath,
      framework: result.framework,
      grade: result.scan.grade,
      summary: result.scan.summary,
      suggestions: result.scan.suggestions,
      warnings: [...result.frameworkWarnings, ...result.scan.warnings],
      ...(result.baseline ? { baseline: result.baseline } : {}),
      map: result.scan.map,
    });
  } else {
    process.stdout.write(
      `${formatMapResult(result, {
        all: options.all,
        ...(options.entry !== undefined ? { entry: options.entry } : {}),
        ...(minScore !== undefined ? { minScore } : {}),
      })}\n`,
    );
  }

  if (minScore !== undefined && result.scan.map.score < minScore) {
    process.exitCode = 1;
    return;
  }
  if (result.baseline && hasRegressed(result.baseline)) {
    process.exitCode = 1;
  }
}
