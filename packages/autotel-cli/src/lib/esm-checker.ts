import * as path from 'node:path';
import type { ProjectContext } from '../types/index';
import { readFileSafe } from './fs';
import { getEntrypointCandidates } from './project';

/**
 * ESM hook check result
 */
export interface EsmCheckResult {
  status: 'ok' | 'warn' | 'info' | 'error';
  message: string;
  details?: string[];
}

/**
 * Check if autotel/register is imported correctly
 */
export function checkRegisterImportOrder(content: string): {
  found: boolean;
  isFirst: boolean;
  lineNumber: number | null;
} {
  const lines = content.split('\n');
  let registerLine: number | null = null;
  let firstImportLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';

    // Skip empty lines and comments
    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      continue;
    }

    // Check for imports
    if (line.startsWith('import ') || line.startsWith("import'") || line.startsWith('import"')) {
      if (firstImportLine === null) {
        firstImportLine = i + 1;
      }

      if (line.includes('autotel/register')) {
        registerLine = i + 1;
      }
    }
  }

  if (registerLine === null) {
    return { found: false, isFirst: false, lineNumber: null };
  }

  return {
    found: true,
    isFirst: registerLine === firstImportLine,
    lineNumber: registerLine,
  };
}

/**
 * Check ESM hook setup - conservative approach
 */
export function checkEsmHook(project: ProjectContext): EsmCheckResult {
  // Check if project uses ESM
  if (!project.isEsm) {
    return {
      status: 'info',
      message: 'Project uses CommonJS; ESM hook check skipped',
      details: [
        'autotel works best with ESM projects',
        'Consider adding "type": "module" to package.json',
      ],
    };
  }

  // Find entrypoints to check
  const entrypoints = getEntrypointCandidates(project.packageRoot);

  if (entrypoints.length === 0) {
    return {
      status: 'info',
      message: 'Could not find entrypoint files to verify',
      details: [
        'Ensure autotel/register is imported first in your entrypoint',
        'Or use --import flag: node --import ./src/instrumentation.mts dist/index.js',
      ],
    };
  }

  // Check each entrypoint for autotel/register
  for (const entrypoint of entrypoints) {
    const content = readFileSafe(entrypoint);
    if (content === null) continue;

    const result = checkRegisterImportOrder(content);

    // If found but not first, that's a definite problem
    if (result.found && !result.isFirst) {
      return {
        status: 'warn',
        message: `autotel/register import found but not first in ${path.basename(entrypoint)}:${result.lineNumber}`,
        details: [
          'autotel/register must be the first import for instrumentation to work',
          'Move it to the top of the file, before any other imports',
        ],
      };
    }

    // If found and first, good
    if (result.found && result.isFirst) {
      return {
        status: 'ok',
        message: `autotel/register correctly imported first in ${path.basename(entrypoint)}`,
      };
    }
  }

  // Not found in any entrypoint - info, not warning
  // User might be using --import flag
  return {
    status: 'info',
    message: 'Could not verify autotel/register import order',
    details: [
      'Ensure autotel/register is first import in entrypoint',
      'Or use the recommended approach: node --import ./src/instrumentation.mts',
    ],
  };
}

/**
 * Get recommended startup command
 */
export function getRecommendedStartupCommand(
  project: ProjectContext,
  instrumentationPath: string
): string {
  const relPath = path.relative(project.packageRoot, instrumentationPath);

  if (project.hasTypeScript) {
    // Check for tsx
    const hasTsx =
      project.packageJson.devDependencies?.tsx ||
      project.packageJson.dependencies?.tsx;

    if (hasTsx) {
      return `tsx --import ./${relPath} src/index.ts`;
    }

    // Default Node ESM
    return `node --import ./${relPath} dist/index.js`;
  }

  // JavaScript
  return `node --import ./${relPath} src/index.js`;
}

/**
 * Check if scripts use --import flag
 */
export function checkScriptsUseImport(
  scripts: Record<string, string> | undefined,
  _instrumentationPath: string
): { found: boolean; scriptName: string | null } {
  if (!scripts) {
    return { found: false, scriptName: null };
  }

  for (const [name, script] of Object.entries(scripts)) {
    if (script.includes('--import') && script.includes('instrumentation')) {
      return { found: true, scriptName: name };
    }
  }

  return { found: false, scriptName: null };
}
