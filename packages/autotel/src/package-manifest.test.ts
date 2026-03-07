import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(here, '../package.json');

interface PackageJson {
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
}

describe('package manifest', () => {
  it('declares runtime deps required by published bin scripts', () => {
    const pkg = JSON.parse(
      readFileSync(packageJsonPath, 'utf8'),
    ) as PackageJson;

    if (pkg.bin?.intent) {
      expect(pkg.dependencies?.['@tanstack/intent']).toBeDefined();
    }
  });
});
