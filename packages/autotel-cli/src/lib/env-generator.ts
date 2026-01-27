import * as path from 'node:path';
import type { EnvVar } from '../types/index.js';
import { fileExists, readFileSafe } from './fs.js';
import { glob } from 'glob';

/**
 * Generate .env.example content from env vars
 */
export function generateEnvExample(envVars: EnvVar[]): string {
  if (envVars.length === 0) {
    return '';
  }

  const lines: string[] = [
    '# Autotel configuration',
    '# Copy to .env and fill in values',
    '',
  ];

  for (const envVar of envVars) {
    // Add description as comment
    lines.push(`# ${envVar.description}`);

    // Add sensitivity warning
    if (envVar.sensitive) {
      lines.push('# ⚠️ SENSITIVE: Do not commit this value');
    }

    // Add example or placeholder
    const value = envVar.example ?? '';
    lines.push(`${envVar.name}=${value}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Parse env file into key-value pairs
 */
export function parseEnvFile(content: string): Map<string, string> {
  const vars = new Map<string, string>();
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    // Parse key=value
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      vars.set(key, value);
    }
  }

  return vars;
}

/**
 * Find all env files in a directory
 */
export async function findEnvFiles(packageRoot: string): Promise<string[]> {
  const patterns = ['.env', '.env.local', '.env.*'];
  const files: string[] = [];

  for (const pattern of patterns) {
    try {
      const matches = await glob(pattern, {
        cwd: packageRoot,
        absolute: true,
        dot: true,
      });
      files.push(...matches);
    } catch {
      // Ignore glob errors
    }
  }

  // Remove duplicates and filter existing files
  return [...new Set(files)].filter((f) => fileExists(f));
}

/**
 * Check if env var is present in any env file
 */
export async function checkEnvVarPresent(
  packageRoot: string,
  varName: string,
  specificFile?: string
): Promise<{ found: boolean; file: string | null }> {
  const files = specificFile
    ? [path.resolve(packageRoot, specificFile)]
    : await findEnvFiles(packageRoot);

  for (const file of files) {
    const content = readFileSafe(file);
    if (content === null) {
      continue;
    }

    const vars = parseEnvFile(content);
    if (vars.has(varName)) {
      return { found: true, file };
    }
  }

  return { found: false, file: null };
}

/**
 * Check multiple env vars presence
 */
export async function checkEnvVarsPresent(
  packageRoot: string,
  varNames: string[],
  specificFile?: string
): Promise<Map<string, { found: boolean; file: string | null }>> {
  const results = new Map<string, { found: boolean; file: string | null }>();

  for (const varName of varNames) {
    const result = await checkEnvVarPresent(packageRoot, varName, specificFile);
    results.set(varName, result);
  }

  return results;
}
