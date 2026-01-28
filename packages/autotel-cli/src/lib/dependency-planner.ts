import type { Preset, PackageRequirements } from '../types/index';

/**
 * Dependency plan for installation
 */
export interface DependencyPlan {
  required: string[];
  optional: string[];
  devOnly: string[];
}

/**
 * Create empty dependency plan
 */
export function createDependencyPlan(): DependencyPlan {
  return {
    required: [],
    optional: [],
    devOnly: [],
  };
}

/**
 * Merge packages into plan without duplicates
 */
function mergePackages(target: string[], source: string[]): void {
  for (const pkg of source) {
    if (!target.includes(pkg)) {
      target.push(pkg);
    }
  }
}

/**
 * Add preset packages to dependency plan
 */
export function addPresetToPlan(plan: DependencyPlan, preset: Preset): void {
  mergePackages(plan.required, preset.packages.required);
  mergePackages(plan.optional, preset.packages.optional);
  mergePackages(plan.devOnly, preset.packages.devOnly);
}

/**
 * Add multiple presets to dependency plan
 */
export function addPresetsToPlan(plan: DependencyPlan, presets: Preset[]): void {
  for (const preset of presets) {
    addPresetToPlan(plan, preset);
  }
}

/**
 * Get all packages that should be installed
 */
export function getProdPackages(plan: DependencyPlan): string[] {
  return [...plan.required, ...plan.optional];
}

/**
 * Get dev packages that should be installed
 */
export function getDevPackages(plan: DependencyPlan): string[] {
  return [...plan.devOnly];
}

/**
 * Add core autotel packages
 */
export function addCorePackages(plan: DependencyPlan): void {
  mergePackages(plan.required, ['autotel']);
}

/**
 * Add auto-instrumentation packages
 */
export function addAutoInstrumentationPackages(
  plan: DependencyPlan,
  selection: 'all' | 'none' | string[]
): void {
  if (selection === 'none') {
    return;
  }

  if (selection === 'all') {
    mergePackages(plan.required, ['@opentelemetry/auto-instrumentations-node']);
    return;
  }

  // Specific instrumentations
  for (const name of selection) {
    mergePackages(plan.required, [`@opentelemetry/instrumentation-${name}`]);
  }
}

/**
 * Build dependency plan from selections
 */
export function buildDependencyPlan(options: {
  presets: Preset[];
  autoInstrumentations: 'all' | 'none' | string[];
}): DependencyPlan {
  const plan = createDependencyPlan();

  // Add core
  addCorePackages(plan);

  // Add presets
  addPresetsToPlan(plan, options.presets);

  // Add auto-instrumentations
  addAutoInstrumentationPackages(plan, options.autoInstrumentations);

  return plan;
}

/**
 * Combine package requirements
 */
export function combinePackageRequirements(
  requirements: PackageRequirements[]
): PackageRequirements {
  const combined: PackageRequirements = {
    required: [],
    optional: [],
    devOnly: [],
  };

  for (const req of requirements) {
    mergePackages(combined.required, req.required);
    mergePackages(combined.optional, req.optional);
    mergePackages(combined.devOnly, req.devOnly);
  }

  return combined;
}
