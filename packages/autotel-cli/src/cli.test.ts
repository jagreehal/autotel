import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createProgram } from './cli';

describe('createProgram', () => {
  it('reports the package version', () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(createProgram().version()).toBe(version);
  });
});
