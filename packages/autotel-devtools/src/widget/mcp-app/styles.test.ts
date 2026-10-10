import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = resolve(__dirname);
const WIDGET = resolve(HERE, '..');

/** Every file the view imports, following relative imports from TraceApp. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
      const base = resolve(dirname(file), spec);
      const found = [base, `${base}.ts`, `${base}/index.ts`].find(
        (candidate) =>
          existsSync(candidate) && /\.(svelte|ts)$/.test(candidate),
      );
      if (found) queue.push(found);
    }
  }
  return seen;
}

/** The `@source` globs in the view's stylesheet, as regexes over widget paths. */
function sourcePatterns(): RegExp[] {
  const css = readFileSync(resolve(HERE, 'styles.css'), 'utf8');
  return [...css.matchAll(/@source\s+'([^']+)'/g)].map(([, glob]) => {
    const path = relative(WIDGET, resolve(HERE, glob));
    const pattern = path
      .replaceAll('.', String.raw`\.`)
      .replaceAll('*', '[^/]*')
      .replaceAll(
        /\{([^}]+)\}/g,
        (_, names: string) => `(${names.replaceAll(',', '|')})`,
      );
    // A directory source covers everything beneath it.
    return new RegExp(`^${pattern}(/.*)?$`);
  });
}

describe('MCP App stylesheet', () => {
  it('imports the theme before any other rule, where CSS still honours it', () => {
    const lines = readFileSync(resolve(HERE, 'styles.css'), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('@'));
    const imports = lines.filter((line) => line.startsWith('@import'));

    expect(lines).toContain("@import '../theme.css';");
    expect(lines.slice(0, imports.length)).toEqual(imports);
  });

  it('scans every component the trace view renders', () => {
    const patterns = sourcePatterns();
    const unscanned = [...importGraph(resolve(HERE, 'TraceApp.svelte'))]
      .map((file) => relative(WIDGET, file))
      .filter((file) => file.endsWith('.svelte'))
      .filter((file) => !patterns.some((pattern) => pattern.test(file)));

    expect(unscanned).toEqual([]);
  });
});
