import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NextConfig } from 'next';
import { withAutotelConfig } from './next-config';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/** A Next app directory with these packages installed in its node_modules. */
function app(installed: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-config-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app"}');
  for (const name of installed) {
    const pkg = path.join(dir, 'node_modules', name);
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name, main: 'index.js' }),
    );
    fs.writeFileSync(path.join(pkg, 'index.js'), '');
  }
  return dir;
}

/**
 * Measured with `next build --webpack` (apps/example-nextjs): a bundled
 * autotel and an external instrumentation, or the reverse, run on two
 * @opentelemetry/api copies. Externalizing @opentelemetry/api itself gives
 * every bundle the same copy, as long as Next can resolve it from the app.
 */
describe('withAutotelConfig', () => {
  it('externalizes @opentelemetry/api, keeping what the config already lists', () => {
    const projectDir = app(['@opentelemetry/api', 'sharp']);
    expect(
      withAutotelConfig(
        { reactCompiler: true, serverExternalPackages: ['sharp'] },
        { projectDir },
      ),
    ).toEqual({
      reactCompiler: true,
      serverExternalPackages: ['sharp', '@opentelemetry/api'],
    });
  });

  it('externalizes the instrumentations it is given, once each', () => {
    const projectDir = app(['@opentelemetry/api', '@prisma/instrumentation']);
    expect(
      withAutotelConfig(
        { serverExternalPackages: ['@prisma/instrumentation'] },
        { projectDir, externals: ['@prisma/instrumentation'] },
      ).serverExternalPackages,
    ).toEqual(['@prisma/instrumentation', '@opentelemetry/api']);
  });

  it('fails the build, naming the fix, when a package is not resolvable from the app', () => {
    const projectDir = app(['@opentelemetry/api']);
    expect(() =>
      withAutotelConfig(
        {},
        { projectDir, externals: ['@prisma/instrumentation'] },
      ),
    ).toThrow(/@prisma\/instrumentation.*dependencies of this app/s);
    expect(() => withAutotelConfig({}, { projectDir: app([]) })).toThrow(
      /@opentelemetry\/api/,
    );
  });
});

/**
 * Type checks, run by `tsc`: the README's own call, a typed NextConfig, and
 * the result still a NextConfig with its properties' types intact.
 */
describe('withAutotelConfig types', () => {
  it('accepts any Next config and returns its type', () => {
    const projectDir = app(['@opentelemetry/api']);
    const inline = withAutotelConfig({ reactCompiler: true }, { projectDir });
    const reactCompiler: boolean = inline.reactCompiler;

    const typed: NextConfig = { reactCompiler: true, poweredByHeader: false };
    const config: NextConfig = withAutotelConfig(typed, { projectDir });

    expect(reactCompiler).toBe(true);
    expect(config.serverExternalPackages).toEqual(['@opentelemetry/api']);
  });
});
