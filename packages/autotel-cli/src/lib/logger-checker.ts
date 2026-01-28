import * as path from 'node:path';
import * as fs from 'node:fs';
import { readFileSafe } from './fs';

/**
 * Logger instrumentation mapping
 */
const LOGGER_INSTRUMENTATION = {
  winston: '@opentelemetry/instrumentation-winston',
  bunyan: '@opentelemetry/instrumentation-bunyan',
  pino: '@opentelemetry/instrumentation-pino',
} as const;

/**
 * Extract autoInstrumentations from source code
 * Looks for patterns like:
 * - autoInstrumentations: ['winston', 'bunyan']
 * - autoInstrumentations: true
 * - autoInstrumentations: { winston: { enabled: true } }
 */
export function extractAutoInstrumentations(
  content: string
): string[] {
  const instrumentations: string[] = [];

  // Pattern 1: Array format: autoInstrumentations: ['winston', 'bunyan']
  const arrayPattern = /autoInstrumentations\s*:\s*\[(.*?)\]/s;
  const arrayMatch = content.match(arrayPattern);
  if (arrayMatch && arrayMatch[1]) {
    const items = arrayMatch[1]
      .split(',')
      .map((item) => item.trim().replaceAll(/['"]/g, ''))
      .filter((item) => item.length > 0);
    instrumentations.push(...items);
  }

  // Pattern 2: Object format: autoInstrumentations: { winston: { enabled: true } }
  const objectPattern = /autoInstrumentations\s*:\s*\{([^}]+)\}/s;
  const objectMatch = content.match(objectPattern);
  if (objectMatch && objectMatch[1]) {
    const props = objectMatch[1];
    // Extract keys that have enabled: true
    const enabledPattern = /(\w+)\s*:\s*\{[^}]*enabled\s*:\s*true[^}]*\}/g;
    let enabledMatch;
    while ((enabledMatch = enabledPattern.exec(props)) !== null) {
      if (enabledMatch[1]) {
        instrumentations.push(enabledMatch[1]);
      }
    }
  }

  return [...new Set(instrumentations)]; // Remove duplicates
}

/**
 * Find all source files that might contain init() calls
 */
export function findSourceFiles(packageRoot: string): string[] {
  const sourceFiles: string[] = [];
  const srcDir = path.join(packageRoot, 'src');

  // Check common source directories
  const dirsToCheck = [packageRoot, srcDir].filter((dir) =>
    fs.existsSync(dir) && fs.statSync(dir).isDirectory()
  );

  for (const dir of dirsToCheck) {
    const files = fs.readdirSync(dir, { recursive: true });
    for (const file of files) {
      if (typeof file !== 'string') continue;
      const filePath = path.join(dir, file);
      try {
        if (
          fs.statSync(filePath).isFile() &&
          /\.(ts|js|mts|mjs|tsx|jsx)$/.test(file)
        ) {
          sourceFiles.push(filePath);
        }
      } catch {
        // Skip files that can't be accessed
      }
    }
  }

  return sourceFiles;
}

/**
 * Check logger instrumentation configuration
 */
export function checkLoggerInstrumentation(
  packageRoot: string,
  deps: Record<string, string>
): {
  logger: 'winston' | 'bunyan' | 'pino' | null;
  hasLogger: boolean;
  hasInstrumentation: boolean;
  configuredInCode: boolean;
  instrumentationPackage: string | null;
} {
  // Check if logger packages are installed
  const hasWinston = !!deps['winston'];
  const hasBunyan = !!deps['bunyan'];
  const hasPino = !!deps['pino'];

  let logger: 'winston' | 'bunyan' | 'pino' | null = null;
  if (hasWinston) logger = 'winston';
  else if (hasBunyan) logger = 'bunyan';
  else if (hasPino) logger = 'pino';

  if (!logger) {
    return {
      logger: null,
      hasLogger: false,
      hasInstrumentation: false,
      configuredInCode: false,
      instrumentationPackage: null,
    };
  }

  const instrumentationPackage = LOGGER_INSTRUMENTATION[logger];
  const hasInstrumentation = !!deps[instrumentationPackage];

  // Check if logger is configured in source code
  const sourceFiles = findSourceFiles(packageRoot);
  let configuredInCode = false;

  for (const filePath of sourceFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;

    // Check if init() is called
    if (!content.includes('init(')) continue;

    // Extract autoInstrumentations
    const instrumentations = extractAutoInstrumentations(content);
    if (instrumentations.includes(logger)) {
      configuredInCode = true;
      break;
    }
  }

  return {
    logger,
    hasLogger: true,
    hasInstrumentation,
    configuredInCode,
    instrumentationPackage,
  };
}
