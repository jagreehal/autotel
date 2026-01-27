import * as semver from 'semver';
import type { PackageJson } from '../types/index.js';

/**
 * Installed package info
 */
export interface InstalledPackage {
  name: string;
  version: string;
  isDev: boolean;
}

/**
 * Missing package info
 */
export interface MissingPackage {
  name: string;
  reason: string;
  requiredBy?: string;
}

/**
 * Audit result for dependency checking
 */
export interface DependencyAudit {
  installed: InstalledPackage[];
  missing: MissingPackage[];
  versionMismatch: Array<{
    name: string;
    installed: string;
    expected: string;
  }>;
}

/**
 * Get all installed packages from package.json
 */
export function getInstalledPackages(packageJson: PackageJson): InstalledPackage[] {
  const installed: InstalledPackage[] = [];

  const deps = packageJson.dependencies ?? {};
  const devDeps = packageJson.devDependencies ?? {};

  for (const [name, version] of Object.entries(deps)) {
    installed.push({ name, version, isDev: false });
  }

  for (const [name, version] of Object.entries(devDeps)) {
    // Don't duplicate if in both
    if (!deps[name]) {
      installed.push({ name, version, isDev: true });
    }
  }

  return installed;
}

/**
 * Check if a package is installed
 */
export function isPackageInstalled(
  packageJson: PackageJson,
  packageName: string
): { installed: boolean; version: string | null; isDev: boolean } {
  const deps = packageJson.dependencies ?? {};
  const devDeps = packageJson.devDependencies ?? {};

  if (deps[packageName]) {
    return { installed: true, version: deps[packageName] ?? null, isDev: false };
  }

  if (devDeps[packageName]) {
    return { installed: true, version: devDeps[packageName] ?? null, isDev: true };
  }

  return { installed: false, version: null, isDev: false };
}

/**
 * Find missing packages from a required list
 */
export function findMissingPackages(
  packageJson: PackageJson,
  required: string[],
  reason?: string
): MissingPackage[] {
  const missing: MissingPackage[] = [];

  for (const pkg of required) {
    const { installed } = isPackageInstalled(packageJson, pkg);
    if (!installed) {
      missing.push({
        name: pkg,
        reason: reason ?? 'Required dependency',
      });
    }
  }

  return missing;
}

/**
 * Check version compatibility between autotel packages
 */
export function checkAutotelVersions(
  packageJson: PackageJson
): { compatible: boolean; packages: Array<{ name: string; version: string }> } {
  const autotelPackages = ['autotel', 'autotel-backends', 'autotel-plugins', 'autotel-subscribers'];
  const installed: Array<{ name: string; version: string; major: number }> = [];

  for (const pkg of autotelPackages) {
    const { installed: isInstalled, version } = isPackageInstalled(packageJson, pkg);
    if (isInstalled && version) {
      const cleanVersion = version.replace(/^[\^~]/, '');
      const parsed = semver.parse(cleanVersion);
      if (parsed) {
        installed.push({ name: pkg, version: cleanVersion, major: parsed.major });
      }
    }
  }

  if (installed.length <= 1) {
    return { compatible: true, packages: installed };
  }

  // Check if all major versions match
  const majors = new Set(installed.map((p) => p.major));
  const compatible = majors.size === 1;

  return { compatible, packages: installed };
}

/**
 * Audit dependencies for a preset
 */
export function auditPresetDependencies(
  packageJson: PackageJson,
  requiredPackages: string[],
  presetName: string
): DependencyAudit {
  const installed = getInstalledPackages(packageJson);
  const missing: MissingPackage[] = [];
  const versionMismatch: DependencyAudit['versionMismatch'] = [];

  for (const pkg of requiredPackages) {
    const result = isPackageInstalled(packageJson, pkg);
    if (!result.installed) {
      missing.push({
        name: pkg,
        reason: `Required by ${presetName} preset`,
        requiredBy: presetName,
      });
    }
  }

  return {
    installed,
    missing,
    versionMismatch,
  };
}

/**
 * Get autotel core package info if installed
 */
export function getAutotelInfo(packageJson: PackageJson): {
  installed: boolean;
  version: string | null;
} {
  const { installed, version } = isPackageInstalled(packageJson, 'autotel');
  return { installed, version };
}
