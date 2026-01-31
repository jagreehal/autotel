import * as path from 'node:path';
import { glob } from 'glob';
import type { CodemodTraceOptions } from '../types/index';
import { readFileSafe, fileExists } from '../lib/fs';
import { transformFile } from '../lib/codemod-trace';
import * as output from '../ui/output';

const CODEMOD_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const GLOB_META = /[*?[\]]/;

/**
 * Resolve path argument to a list of absolute file paths.
 * - If path has no glob metacharacters and is an existing file, return that file.
 * - Otherwise treat as glob; restrict to .ts, .tsx, .js, .jsx; exclude node_modules and *.d.ts.
 */
export async function resolveCodemodFiles(
  pathArg: string,
  cwd: string
): Promise<string[]> {
  const isGlob = GLOB_META.test(pathArg);
  if (!isGlob) {
    const absolute = path.isAbsolute(pathArg) ? pathArg : path.resolve(cwd, pathArg);
    if (fileExists(absolute)) {
      const ext = path.extname(absolute);
      if (CODEMOD_EXTENSIONS.has(ext) && !absolute.endsWith('.d.ts')) {
        return [absolute];
      }
      return [];
    }
  }

  const pattern = path.isAbsolute(pathArg) ? pathArg : path.join(cwd, pathArg);
  const matches = await glob(pattern, {
    cwd,
    absolute: true,
    ignore: ['**/node_modules/**', '**/*.d.ts'],
  });

  return matches.filter((f) => {
    const ext = path.extname(f);
    return CODEMOD_EXTENSIONS.has(ext) && !f.endsWith('.d.ts');
  });
}

/**
 * Run the codemod trace command: resolve files, transform each, write or dry-run.
 */
export async function runCodemodTrace(options: CodemodTraceOptions): Promise<void> {
  const { path: pathArg, cwd, dryRun, namePattern, skip, printFiles, verbose, quiet } = options;

  const files = await resolveCodemodFiles(pathArg, cwd);
  if (files.length === 0) {
    if (!quiet) {
      output.error(`No matching files found for: ${pathArg}`);
    }
    process.exitCode = 1;
    return;
  }

  const skipRegExps = skip?.map((s) => new RegExp(s)) ?? [];
  const transformOptions = { namePattern, skip: skipRegExps.length > 0 ? skipRegExps : undefined };

  let totalWrapped = 0;
  let totalChanged = 0;

  for (const filePath of files) {
    const content = readFileSafe(filePath);
    if (content === null) {
      if (verbose) output.dim(`Skip ${filePath} (unreadable)`);
      continue;
    }

    let result: Awaited<ReturnType<typeof transformFile>>;
    try {
      result = transformFile(content, filePath, transformOptions);
    } catch (error) {
      if (!quiet) {
        output.error(`Failed to transform ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (verbose && error instanceof Error && error.stack) output.dim(error.stack);
      process.exitCode = 1;
      continue;
    }


    const relativePath = path.relative(cwd, filePath);

    if (result.changed) {
      totalWrapped += result.wrappedCount;
      totalChanged += 1;
      if (!dryRun) {
        const fs = await import('node:fs');
        fs.writeFileSync(filePath, result.modified, 'utf8');
      }
    }

    const showSummary = printFiles || dryRun || result.changed;
    if (showSummary && !quiet) {
      if (result.changed) {
        console.log(`✔ ${relativePath} (${result.wrappedCount} wrapped)`);
      } else if (result.skipped.length > 0) {
        const reasons = [...new Set(result.skipped.map((s) => s.reason))].join('; ');
        console.log(`↷ ${relativePath} (skipped: ${reasons})`);
      }
    }
  }

  if (dryRun && totalChanged > 0 && !quiet) {
    console.log('');
    output.dim(`Dry run: ${totalChanged} file(s) would be updated, ${totalWrapped} function(s) wrapped.`);
  }
}
