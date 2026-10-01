/**
 * Source maps turn a bundle frame (`index.js:9192:27` in wrangler's temp dir)
 * back into the file and line that threw, so issues group by source and a
 * fixer is pointed at real code. Exercised against a real esbuild bundle,
 * run so V8 produces the stack, rather than a hand-written map.
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInThisContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createSourceMapResolver } from '../sourcemap';
import { culpritOf } from '../../issues';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function bundle(sourcemap: 'external' | 'inline') {
  const root = mkdtempSync(path.join(tmpdir(), 'autotel-sm-'));
  dirs.push(root);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(
    path.join(root, 'src', 'payments.ts'),
    [
      'export function chargeCard(amount: number): never {',
      '  const reason: string = `card declined for ${amount}`;',
      '  throw new TypeError(reason);',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'src', 'index.ts'),
    "import { chargeCard } from './payments';\n(globalThis as any).__run = () => chargeCard(500);\n",
  );
  const out = path.join(root, '.wrangler', 'tmp', 'dev-Xy12', 'index.js');
  buildSync({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    bundle: true,
    outfile: out,
    format: 'iife',
    sourcemap,
    // Padding so the throw is deep in the bundle, as it is in a real worker.
    banner: { js: '/* pad */\n'.repeat(50) },
  });
  return { root, out };
}

function stackFrom(file: string, code: string): string {
  runInThisContext(code, { filename: file });
  try {
    (globalThis as unknown as { __run: () => void }).__run();
  } catch (error) {
    return (error as Error).stack ?? '';
  }
  throw new Error('bundle did not throw');
}

describe('createSourceMapResolver', () => {
  it('maps a bundled frame back to the source file and line (sibling .map)', () => {
    const { root, out } = bundle('external');
    const stack = stackFrom(out, readFileSync(out, 'utf8'));
    expect(stack).toContain('index.js');

    const resolved = createSourceMapResolver({ roots: [root] }).resolveStack(
      stack,
    );
    expect(resolved).toContain(`${path.join(root, 'src', 'payments.ts')}:3:`);
    expect(resolved.split('\n')[0]).toBe('TypeError: card declined for 500');
    expect(culpritOf(resolved)).toBe('chargeCard (payments.ts)');
  });

  it('reads an inline data: URI map', () => {
    const { root, out } = bundle('inline');
    const resolved = createSourceMapResolver({ roots: [root] }).resolveStack(
      stackFrom(out, readFileSync(out, 'utf8')),
    );
    expect(resolved).toContain('payments.ts:3:');
  });

  it('uses uploaded maps by basename when the bundle is not on this machine', () => {
    const { out } = bundle('external');
    const stack = stackFrom(out, readFileSync(out, 'utf8'));
    const mapsDir = mkdtempSync(path.join(tmpdir(), 'autotel-maps-'));
    dirs.push(mapsDir);
    copyFileSync(`${out}.map`, path.join(mapsDir, 'index.js.map'));
    // No roots: the bundle path itself is unreadable, as on a remote host.
    const resolved = createSourceMapResolver({ mapsDir }).resolveStack(stack);
    expect(resolved).toContain('payments.ts:3:');
  });

  it('never reads outside the configured roots, and leaves unmapped stacks alone', () => {
    const { out } = bundle('external');
    const stack = stackFrom(out, readFileSync(out, 'utf8'));
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'autotel-other-'));
    dirs.push(elsewhere);
    expect(
      createSourceMapResolver({ roots: [elsewhere] }).resolveStack(stack),
    ).toBe(stack);
    expect(createSourceMapResolver().resolveStack(stack)).toBe(stack);
  });
});
