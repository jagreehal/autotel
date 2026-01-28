import * as path from 'node:path';
import type { PackageJson, ProjectContext, WorkspaceInfo } from '../types/index';
import { fileExists, dirExists, readJsonSafe, findUpward } from './fs';
import { detectPackageManager, detectWorkspaceRoot } from './package-manager';

/**
 * Find package.json starting from cwd, walking up if needed
 */
export function findPackageJson(startDir: string): {
  packageJsonPath: string;
  packageRoot: string;
} | null {
  const packageJsonPath = findUpward(startDir, 'package.json');
  if (!packageJsonPath) {
    return null;
  }
  return {
    packageJsonPath,
    packageRoot: path.dirname(packageJsonPath),
  };
}

/**
 * Detect if project uses TypeScript
 */
export function detectTypeScript(packageRoot: string): boolean {
  // Check for tsconfig.json
  if (fileExists(path.join(packageRoot, 'tsconfig.json'))) {
    return true;
  }

  // Check for typescript in dependencies
  const pkgJson = readJsonSafe<PackageJson>(path.join(packageRoot, 'package.json'));
  if (pkgJson) {
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    if ('typescript' in deps) {
      return true;
    }
  }

  return false;
}

/**
 * Detect if project uses ESM
 */
export function detectEsm(packageJson: PackageJson): boolean {
  return packageJson.type === 'module';
}

/**
 * Build workspace info
 */
export function buildWorkspaceInfo(
  packageRoot: string,
  cwd: string
): WorkspaceInfo {
  const { workspaceRoot, workspaceType } = detectWorkspaceRoot(cwd);

  return {
    isMonorepo: workspaceRoot !== null && workspaceRoot !== packageRoot,
    workspaceRoot,
    packageRoot,
    workspaceType,
  };
}

/**
 * Discover project context from a directory
 */
export function discoverProject(cwd: string): ProjectContext | null {
  const resolvedCwd = path.resolve(cwd);

  // Find package.json
  const pkgResult = findPackageJson(resolvedCwd);
  if (!pkgResult) {
    return null;
  }

  const { packageJsonPath, packageRoot } = pkgResult;

  // Read package.json
  const packageJson = readJsonSafe<PackageJson>(packageJsonPath);
  if (!packageJson) {
    return null;
  }

  // Detect package manager
  const { packageManager, lockfilePath } = detectPackageManager(packageRoot);

  // Build workspace info
  const workspace = buildWorkspaceInfo(packageRoot, resolvedCwd);

  // Detect features
  const hasTypeScript = detectTypeScript(packageRoot);
  const isEsm = detectEsm(packageJson);

  return {
    cwd: resolvedCwd,
    packageRoot,
    packageJson,
    packageJsonPath,
    packageManager,
    lockfilePath,
    workspace,
    hasTypeScript,
    isEsm,
  };
}

/**
 * Get common entrypoint candidates
 */
export function getEntrypointCandidates(packageRoot: string): string[] {
  const candidates = [
    'src/index.ts',
    'src/main.ts',
    'src/index.mts',
    'src/main.mts',
    'server.ts',
    'app.ts',
    'index.ts',
    'src/index.js',
    'src/main.js',
    'server.js',
    'app.js',
    'index.js',
  ];

  return candidates
    .map((c) => path.join(packageRoot, c))
    .filter((p) => fileExists(p));
}

/**
 * Get instrumentation file path based on project conventions
 */
export function getInstrumentationPath(
  packageRoot: string,
  hasTypeScript: boolean
): string {
  // Check if src/ exists (as directory or has files inside)
  const srcDir = path.join(packageRoot, 'src');
  const hasSrcDir = dirExists(srcDir) ||
    fileExists(path.join(packageRoot, 'src', 'index.ts')) ||
    fileExists(path.join(packageRoot, 'src', 'index.js'));

  const dir = hasSrcDir ? path.join(packageRoot, 'src') : packageRoot;
  const ext = hasTypeScript ? 'mts' : 'mjs';

  return path.join(dir, `instrumentation.${ext}`);
}
