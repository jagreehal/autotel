import * as path from 'node:path';
import type { PackageManager } from '../types/index';
import { fileExists, findAllUpward, readFileSafe } from './fs';

/**
 * Lockfile to package manager mapping
 */
const LOCKFILE_MAP: Record<string, PackageManager> = {
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
};

/**
 * All lockfile names in priority order
 */
const LOCKFILES = ['pnpm-lock.yaml', 'bun.lockb', 'yarn.lock', 'package-lock.json'];

/**
 * Priority order when multiple lockfiles at same level (pnpm > bun > yarn > npm)
 */
const PM_PRIORITY: PackageManager[] = ['pnpm', 'bun', 'yarn', 'npm'];

/**
 * Detect package manager from nearest lockfile
 * Algorithm: Find closest lockfile to cwd, working upward
 */
export function detectPackageManager(startDir: string): {
  packageManager: PackageManager;
  lockfilePath: string | null;
} {
  const foundLockfiles = findAllUpward(startDir, LOCKFILES);

  if (foundLockfiles.size === 0) {
    return { packageManager: 'npm', lockfilePath: null };
  }

  // Find the closest lockfile (deepest path = closest to startDir)
  let closestLockfile: string | null = null;
  let closestDepth = -1;
  let closestPM: PackageManager = 'npm';

  for (const [lockfileName, lockfilePath] of foundLockfiles) {
    const depth = lockfilePath.split(path.sep).length;
    const pm = LOCKFILE_MAP[lockfileName];

    if (pm === undefined) continue;

    // Deeper path = closer to startDir (wins), or same depth with higher priority
    if (
      depth > closestDepth ||
      (depth === closestDepth && PM_PRIORITY.indexOf(pm) < PM_PRIORITY.indexOf(closestPM))
    ) {
      closestDepth = depth;
      closestLockfile = lockfilePath;
      closestPM = pm;
    }
  }

  return {
    packageManager: closestPM,
    lockfilePath: closestLockfile,
  };
}

/**
 * Get install command for a package manager
 */
export function getInstallCommand(
  pm: PackageManager,
  packages: string[],
  options: { dev?: boolean; workspaceRoot?: boolean } = {}
): string {
  const pkgList = packages.join(' ');
  const { dev = false, workspaceRoot = false } = options;

  switch (pm) {
    case 'pnpm': {
      const devFlag = dev ? ' -D' : '';
      const wsFlag = workspaceRoot ? ' -w' : '';
      return `pnpm add${devFlag}${wsFlag} ${pkgList}`;
    }
    case 'bun': {
      const devFlag = dev ? ' -d' : '';
      return `bun add${devFlag} ${pkgList}`;
    }
    case 'yarn': {
      const devFlag = dev ? ' -D' : '';
      const wsFlag = workspaceRoot ? ' -W' : '';
      return `yarn add${devFlag}${wsFlag} ${pkgList}`;
    }
    case 'npm':
    default: {
      const devFlag = dev ? ' --save-dev' : '';
      return `npm install${devFlag} ${pkgList}`;
    }
  }
}

/**
 * Get run command for a package manager
 */
export function getRunCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm ${script}`;
    case 'bun':
      return `bun run ${script}`;
    case 'yarn':
      return `yarn ${script}`;
    case 'npm':
    default:
      return `npm run ${script}`;
  }
}

/**
 * Get exec command for a package manager (npx equivalent)
 */
export function getExecCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm dlx';
    case 'bun':
      return 'bunx';
    case 'yarn':
      return 'yarn dlx';
    case 'npm':
    default:
      return 'npx';
  }
}

/**
 * Detect workspace root markers
 */
export function detectWorkspaceRoot(startDir: string): {
  workspaceRoot: string | null;
  workspaceType: 'pnpm' | 'yarn' | 'npm' | 'lerna' | null;
} {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    // Check for pnpm workspace
    if (fileExists(path.join(currentDir, 'pnpm-workspace.yaml'))) {
      return { workspaceRoot: currentDir, workspaceType: 'pnpm' };
    }

    // Check for Lerna
    if (fileExists(path.join(currentDir, 'lerna.json'))) {
      return { workspaceRoot: currentDir, workspaceType: 'lerna' };
    }

    // Check for workspaces in package.json
    const pkgJsonPath = path.join(currentDir, 'package.json');
    const pkgJsonContent = readFileSafe(pkgJsonPath);
    if (pkgJsonContent) {
      try {
        const pkgJson = JSON.parse(pkgJsonContent) as { workspaces?: unknown };
        if (pkgJson.workspaces) {
          // Determine if yarn or npm based on lockfile
          const hasYarnLock = fileExists(path.join(currentDir, 'yarn.lock'));
          return {
            workspaceRoot: currentDir,
            workspaceType: hasYarnLock ? 'yarn' : 'npm',
          };
        }
      } catch {
        // Ignore parse errors
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return { workspaceRoot: null, workspaceType: null };
}
