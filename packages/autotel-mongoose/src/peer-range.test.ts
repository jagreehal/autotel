import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) =>
  readFileSync(path.join(here, '..', file), 'utf8');

describe('mongoose peer range', () => {
  // The floor reached >=9.8.0 by tracking the devDependency through routine
  // `ncu` runs — three bumps in lockstep, none of them a decision that Mongoose
  // 8 had stopped working. It had not: the suite passes against 8.x, and the
  // package ships a `kareem2` alias precisely for the pre-v3 hook engine 8 uses.
  // A peer floor is a claim about what is supported, so it has to be pinned to
  // something that fails when it drifts.
  const peer = JSON.parse(read('package.json')).peerDependencies
    .mongoose as string;

  it('declares the oldest supported major, not the development version', () => {
    expect(peer).toBe('>=8.0.0');
  });

  it('agrees with the support claim in the README', () => {
    const readme = read('README.md');
    const claimed = /supports Mongoose (\d+)\+/.exec(readme)?.[1];
    const declared = /^>=(\d+)\./.exec(peer)?.[1];

    expect(claimed).toBeDefined();
    expect(declared).toBe(claimed);
  });

  it('does not track the devDependency', () => {
    // The tell for the original bug: a floor that always equals whatever
    // version happens to be installed for development.
    const pkg = JSON.parse(read('package.json'));
    const dev = pkg.devDependencies.mongoose as string;

    expect(peer).not.toBe(`>=${dev.replace(/^[\^~]/, '')}`);
  });
});
