import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the library build, not the source: rolldown's browser platform folds
// `process.env.NODE_ENV` to a constant unless told otherwise, which made
// `isDevelopment()` return the build machine's answer for every consumer.
// Several entries share it, so it lands in whichever chunk the bundler picks.
const dist = new URL('../dist/', import.meta.url);

describe.skipIf(!existsSync(dist))('dist', () => {
  it('leaves process.env.NODE_ENV for the consuming bundler', () => {
    const chunks = readdirSync(dist)
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(new URL(file, dist), 'utf8'))
      .filter((js) => js.includes('function isDevelopment'));
    expect(chunks.length).toBeGreaterThan(0);
    for (const js of chunks) expect(js).toContain('process.env.NODE_ENV');
  });

  // A browser loading the lean entry without a bundler cannot resolve a bare
  // `@opentelemetry/*` specifier, and the entry promises it needs none.
  it('keeps every @opentelemetry import out of the lean entry', () => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const js = readFileSync(new URL(file, dist), 'utf8');
      expect(js, file).not.toMatch(/from\s*["']@opentelemetry\//);
      for (const [, dep] of js.matchAll(/from\s*["']\.\/([^"']+)["']/g))
        visit(dep);
    };
    visit('index.js');
    expect(seen.size).toBeGreaterThan(1);
  });
});
