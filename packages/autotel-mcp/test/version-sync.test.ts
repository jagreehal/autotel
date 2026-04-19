import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function readUtf8(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8');
}

describe('package version sync', () => {
  it('exposes the package.json version via the shared VERSION constant', async () => {
    const pkg = JSON.parse(await readUtf8('package.json')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it('does not hardcode version literals in app.ts or server.ts', async () => {
    const hardcodedVersion = /version:\s*['"][^'"]+['"]/;
    for (const file of ['src/app.ts', 'src/server.ts']) {
      const source = await readUtf8(file);
      expect(
        hardcodedVersion.test(source),
        `${file} must use the VERSION constant instead of a hardcoded string`,
      ).toBe(false);
    }
  });
});
