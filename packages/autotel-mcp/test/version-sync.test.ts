import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function readUtf8(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8');
}

function extractVersionLiteral(source: string, file: string): string {
  const match = source.match(/version:\s*['"]([^'"]+)['"]/);
  expect(match, `${file} should declare a version field`).toBeTruthy();
  return match![1]!;
}

describe('package version sync', () => {
  it('keeps MCP server and health payload version aligned with package.json', async () => {
    const pkg = JSON.parse(await readUtf8('package.json')) as {
      version: string;
    };
    const appSource = await readUtf8('src/app.ts');
    const serverSource = await readUtf8('src/server.ts');

    const appVersion = extractVersionLiteral(appSource, 'src/app.ts');
    const healthVersion = extractVersionLiteral(serverSource, 'src/server.ts');

    expect(appVersion).toBe(pkg.version);
    expect(healthVersion).toBe(pkg.version);
  });
});
