/**
 * Build an `InitPlan` from a `DetectionResult`.
 *
 * Pure function: takes detection + project context + preset registry, emits
 * the list of presets to wire, packages to install, env vars to surface,
 * and a draft instrumentation file path. Side-effect-free so it can be
 * called from both the interactive flow and the --json/--dry-run flow.
 */

import * as path from 'node:path';
import type {
  DetectionResult,
  PresetSlug,
} from './dep-detector';
import type { InitPlan, InitPlanEnvVar } from './plan';
import type { Preset, ProjectContext } from '../types/index';
import { getPreset } from '../presets/index';
import { fileExists } from './fs';
import { getInstrumentationPath } from './project';

export interface PlanFromDetectionResult {
  plan: InitPlan;
  /** Resolved preset objects in the same order as plan.presets. */
  presets: Preset[];
  /** Path the instrumentation file would be written to. */
  instrumentationPath: string;
}

export function buildPlanFromDetection(opts: {
  project: ProjectContext;
  detection: DetectionResult;
}): PlanFromDetectionResult {
  const { project, detection } = opts;

  // Resolve preset slugs to preset objects. Backends + plugins + subscribers
  // + platforms all share the same Preset shape. We try each type until we
  // find it.
  const presets: Preset[] = [];
  const presetSlugs: PresetSlug[] = [];

  // Always wire the detected backend (even if 'local').
  const backendPreset = findPreset(detection.backend.slug);
  if (backendPreset !== null) {
    presets.push(backendPreset);
    presetSlugs.push(detection.backend.slug);
  }

  // Other presets (subscribers, plugins, platform)
  for (const slug of detection.presets) {
    if (slug === detection.backend.slug) continue; // already added
    const p = findPreset(slug);
    if (p !== null) {
      presets.push(p);
      presetSlugs.push(slug);
    }
  }

  // Build package install set
  const prod = new Set<string>(['autotel']);
  const dev = new Set<string>();
  for (const p of presets) {
    for (const pkg of p.packages.required) prod.add(pkg);
    for (const pkg of p.packages.optional) prod.add(pkg);
    for (const pkg of p.packages.devOnly) dev.add(pkg);
  }

  // Pino is wired as init({ logger }), so we also need `pino` itself
  // available. Detection already saw it in deps, but be explicit so a
  // hand-crafted plan still works.
  if (detection.primaryLogger === 'pino') prod.add('pino');

  // Auto-instrumentations-node covers the auto-instrumented deps + the
  // Winston/Bunyan trace-context injection.
  if (
    detection.autoInstrumentedDeps.length > 0 ||
    detection.autoInstrumentLoggers.length > 0 ||
    detection.primaryLogger === 'winston' ||
    detection.primaryLogger === 'bunyan'
  ) {
    prod.add('@opentelemetry/auto-instrumentations-node');
  }

  // Env vars
  const envVars: InitPlanEnvVar[] = [];
  const seenEnv = new Set<string>();
  for (const p of presets) {
    for (const ev of [...p.env.required, ...p.env.optional]) {
      if (seenEnv.has(ev.name)) continue;
      seenEnv.add(ev.name);
      envVars.push({
        name: ev.name,
        sensitive: ev.sensitive,
        action: 'add-to-.env.example',
      });
    }
  }

  // Files we'll write
  const instrumentationPath = getInstrumentationPath(
    project.packageRoot,
    project.hasTypeScript
  );
  const filesToWrite: InitPlan['filesToWrite'] = [
    {
      path: path.relative(project.cwd, instrumentationPath),
      action: fileExists(instrumentationPath) ? 'merge' : 'create',
    },
  ];
  const envExamplePath = path.join(project.packageRoot, '.env.example');
  if (envVars.length > 0 && !fileExists(envExamplePath)) {
    filesToWrite.push({
      path: path.relative(project.cwd, envExamplePath),
      action: 'create',
    });
  }

  // Aggregated next-steps
  const nextSteps = presets.flatMap((p) => p.nextSteps);

  const plan: InitPlan = {
    v: 1,
    presets: presetSlugs,
    packagesToInstall: { prod: [...prod], dev: [...dev] },
    filesToWrite,
    envVars,
    nextSteps,
    detected: {
      packages: detection.packages,
      primaryLogger: detection.primaryLogger,
      autoInstrumentLoggers: detection.autoInstrumentLoggers,
      autoInstrumentedDeps: detection.autoInstrumentedDeps,
      backend: detection.backend,
      platform: detection.platform,
    },
  };

  return { plan, presets, instrumentationPath };
}

function findPreset(slug: PresetSlug | string): Preset | null {
  for (const type of ['backend', 'subscriber', 'plugin', 'platform'] as const) {
    const p = getPreset(type, slug);
    if (p !== undefined) return p;
  }
  return null;
}
