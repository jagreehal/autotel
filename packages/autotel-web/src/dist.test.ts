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
});
