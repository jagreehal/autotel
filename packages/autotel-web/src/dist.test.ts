import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the library build, not the source: rolldown's browser platform folds
// `process.env.NODE_ENV` to a constant unless told otherwise, which made
// `isDevelopment()` return the build machine's answer for every consumer.
const built = new URL('../dist/full.js', import.meta.url);

describe.skipIf(!existsSync(built))('dist/full.js', () => {
  it('leaves process.env.NODE_ENV for the consuming bundler', () => {
    const js = readFileSync(built, 'utf8');
    expect(js).toContain('process.env.NODE_ENV');
  });
});
