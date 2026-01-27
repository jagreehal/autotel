import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Check if a path is within the allowed root directory
 */
export function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  return resolvedTarget.startsWith(resolvedRoot + path.sep) || resolvedTarget === resolvedRoot;
}

/**
 * Ensure parent directory exists
 */
export function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read file safely, returning null if not found
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Check if file exists
 */
export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Check if directory exists
 */
export function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create backup of a file with .bak extension
 */
export function createBackup(filePath: string): string | null {
  if (!fileExists(filePath)) {
    return null;
  }
  const backupPath = `${filePath}.bak`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Atomic write - write to temp file then rename
 */
export function atomicWrite(
  filePath: string,
  content: string,
  options: { root: string; backup?: boolean }
): { backupPath: string | null } {
  const resolvedPath = path.resolve(filePath);

  // Security: ensure we're writing within root
  if (!isPathWithinRoot(resolvedPath, options.root)) {
    throw new Error(
      `Path traversal detected: ${filePath} resolves outside root ${options.root}`
    );
  }

  // Create backup if requested and file exists
  let backupPath: string | null = null;
  if (options.backup && fileExists(resolvedPath)) {
    backupPath = createBackup(resolvedPath);
  }

  // Ensure parent directory exists
  ensureDir(resolvedPath);

  // Write to temp file first
  const tempPath = `${resolvedPath}.${randomBytes(4).toString('hex')}.tmp`;

  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, resolvedPath);
  } catch (error) {
    // Clean up temp file on error
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }

  return { backupPath };
}

/**
 * Read JSON file safely
 */
export function readJsonSafe<T>(filePath: string): T | null {
  const content = readFileSafe(filePath);
  if (content === null) {
    return null;
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Find a file by walking up the directory tree
 */
export function findUpward(
  startDir: string,
  filename: string,
  stopAtRoot = true
): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const filePath = path.join(currentDir, filename);
    if (fileExists(filePath)) {
      return filePath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
    if (stopAtRoot && currentDir === root) {
      break;
    }
  }

  // Check root as well
  const rootFilePath = path.join(root, filename);
  if (fileExists(rootFilePath)) {
    return rootFilePath;
  }

  return null;
}

/**
 * Find all files matching a pattern by walking up
 */
export function findAllUpward(
  startDir: string,
  filenames: string[]
): Map<string, string> {
  const found = new Map<string, string>();
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    for (const filename of filenames) {
      if (!found.has(filename)) {
        const filePath = path.join(currentDir, filename);
        if (fileExists(filePath)) {
          found.set(filename, filePath);
        }
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return found;
}
