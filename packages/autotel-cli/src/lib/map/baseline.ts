import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AutotelError, AutotelErrorCodes } from '../errors';
import { atomicWrite } from '../fs';
import { classifyRouteObservability, scoreGlobal } from './score';
import type { CheckId, MapFile, RouteEntry } from './types';

/** Committed alongside the code, so the score can be tracked over time. */
export const MAP_FILE_NAME = 'autotel.map.json';

export function writeMapFile(projectRoot: string, map: MapFile): string {
  const target = path.join(projectRoot, MAP_FILE_NAME);
  atomicWrite(target, `${JSON.stringify(map, null, 2)}\n`, {
    root: projectRoot,
  });
  return target;
}

/** Where a baseline map was read from — the label keeps the spelling the user typed. */
export interface BaselineSource {
  kind: 'file' | 'git';
  label: string;
}

/** A requirement that used to pass on this entry point and no longer does. */
export interface CheckRegression {
  routeId: string;
  path: string;
  method: string | null;
  file: string;
  check: CheckId;
  /** Both gate; the distinction is printed because the fix differs. */
  to: 'fail' | 'suppressed';
}

export interface CheckFix {
  routeId: string;
  path: string;
  method: string | null;
  file: string;
  check: CheckId;
}

export interface AddedRoute {
  path: string;
  method: string | null;
  file: string;
  /** No requirement passes on it — the case a baseline gate is meant to surface. */
  dark: boolean;
}

export interface BaselineComparison {
  source: BaselineSource;
  baselineScore: number;
  score: number;
  /**
   * Score movement across the entry points that existed in the baseline.
   *
   * Not `current.score - baseline.score`: that is a weighted average over every
   * route, so a new dark endpoint drags it down and would fail the pull
   * requests this comparison promises not to fail.
   */
  delta: number;
  /** `current.score - baseline.score`, for the report. Never gates. */
  totalDelta: number;
  /** Requirements that went from pass to fail or suppressed. These gate. */
  regressions: CheckRegression[];
  /** Requirements that went from fail to pass — the report's good news. */
  fixed: CheckFix[];
  added: AddedRoute[];
  removed: { path: string; method: string | null }[];
}

function baselineError(source: string, reason: string): AutotelError {
  return new AutotelError({
    type: 'validation',
    code: AutotelErrorCodes.E_INVALID_INPUT,
    message: `Baseline "${source}" ${reason}`,
    fix: `Run "autotel map" on the baseline commit and commit ${MAP_FILE_NAME}, or pass --baseline git:<ref>.`,
  });
}

function readGitBaseline(cwd: string, ref: string): string | null {
  try {
    const prefix = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--show-prefix'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return execFileSync(
      'git',
      ['-C', cwd, 'show', `${ref}:${prefix}${MAP_FILE_NAME}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch {
    return null;
  }
}

function parseMapFile(raw: string, label: string): MapFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw baselineError(label, 'is not valid JSON');
  }
  const map = parsed as Partial<MapFile>;
  if (
    map?.version !== 1 ||
    !Array.isArray(map.routes) ||
    typeof map.score !== 'number'
  ) {
    throw baselineError(label, `is not an ${MAP_FILE_NAME} (version 1)`);
  }
  return map as MapFile;
}

/**
 * Read the map to compare against. Local-only: no network, no token, no
 * repository access, so a private repo gates like a public one.
 *
 * @param spec `git:<ref>` to read the committed copy through git, otherwise a
 * path. Defaults to `autotel.map.json`, falling back to `git:HEAD`.
 */
export function loadBaseline(
  projectRoot: string,
  spec?: string,
): { map: MapFile; source: BaselineSource } {
  if (spec?.startsWith('git:')) {
    const ref = spec.slice(4) || 'HEAD';
    const raw = readGitBaseline(projectRoot, ref);
    if (raw === null) throw baselineError(spec, 'could not be read');
    return {
      map: parseMapFile(raw, spec),
      source: { kind: 'git', label: spec },
    };
  }

  if (spec) {
    const target = path.isAbsolute(spec)
      ? spec
      : path.resolve(projectRoot, spec);
    let raw: string;
    try {
      raw = fs.readFileSync(target, 'utf8');
    } catch {
      throw baselineError(spec, 'could not be read');
    }
    return {
      map: parseMapFile(raw, spec),
      source: { kind: 'file', label: spec },
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(path.resolve(projectRoot, MAP_FILE_NAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw baselineError(MAP_FILE_NAME, 'could not be read');
    }
    /* Run twice in a row, the second scan would otherwise compare against the
       first one's output. */
    const gitRaw = readGitBaseline(projectRoot, 'HEAD');
    if (gitRaw === null)
      throw baselineError(MAP_FILE_NAME, 'could not be read');
    return {
      map: parseMapFile(gitRaw, 'git:HEAD'),
      source: { kind: 'git', label: 'git:HEAD' },
    };
  }

  return {
    map: parseMapFile(raw, MAP_FILE_NAME),
    source: { kind: 'file', label: MAP_FILE_NAME },
  };
}

/**
 * Compare a fresh scan against a baseline, per entry point and per check.
 *
 * The unit is the requirement, not the score: a refactor that instruments one
 * route and breaks another leaves the number untouched. A deleted route is not
 * a regression, and a new dark one is reported but does not gate — that bar is
 * `--min-score`'s job.
 */
export function compareToBaseline(
  baseline: MapFile,
  current: MapFile,
  source: BaselineSource,
): BaselineComparison {
  const currentById = new Map(current.routes.map((route) => [route.id, route]));
  const baselineById = new Map(
    baseline.routes.map((route) => [route.id, route]),
  );

  const regressions: CheckRegression[] = [];
  const fixed: CheckFix[] = [];
  const removed: { path: string; method: string | null }[] = [];

  for (const before of baseline.routes) {
    const after = currentById.get(before.id);
    if (!after) {
      removed.push({ path: before.path, method: before.method });
      continue;
    }

    for (const id of Object.keys(before.checks) as CheckId[]) {
      const was = before.checks[id];
      const now = after.checks[id];
      if (!was || !now) continue;

      const entry = {
        routeId: after.id,
        path: after.path,
        method: after.method,
        file: after.file,
        check: id,
      };

      if (was.status === 'pass' && now.status === 'fail') {
        regressions.push({ ...entry, to: 'fail' });
      } else if (
        was.status === 'pass' &&
        now.status === 'n/a' &&
        now.suppressed
      ) {
        regressions.push({ ...entry, to: 'suppressed' });
      } else if (was.status === 'fail' && now.status === 'pass') {
        fixed.push(entry);
      }
    }
  }

  const added: AddedRoute[] = current.routes
    .filter((route) => !baselineById.has(route.id))
    .map((route) => ({
      path: route.path,
      method: route.method,
      file: route.file,
      // The scan's own classifier, so an exempt route stays exempt here.
      dark: classifyRouteObservability(route) === 'dark',
    }));

  const carried: RouteEntry[] = current.routes.filter((route) =>
    baselineById.has(route.id),
  );
  const carriedBefore: RouteEntry[] = baseline.routes.filter((route) =>
    currentById.has(route.id),
  );

  return {
    source,
    baselineScore: baseline.score,
    score: current.score,
    delta: scoreGlobal(carried) - scoreGlobal(carriedBefore),
    totalDelta: current.score - baseline.score,
    regressions,
    fixed,
    added,
    removed,
  };
}

/** Whether the comparison should fail the command (exit 1). */
export function hasRegressed(comparison: BaselineComparison): boolean {
  return comparison.regressions.length > 0 || comparison.delta < 0;
}
