import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('edge runtime split', () => {
  it('keeps Node and edge runtimes on separate packages', () => {
    const nodeRuntime = readFileSync(path.join(root, 'src/runtime.ts'), 'utf8');
    const edgeRuntime = readFileSync(
      path.join(root, 'src/runtime.edge.ts'),
      'utf8',
    );
    expect(nodeRuntime).toMatch(/from ['"]autotel['"]/);
    expect(nodeRuntime).not.toMatch(/autotel-edge/);
    expect(edgeRuntime).toMatch(/from ['"]autotel-edge['"]/);
    expect(edgeRuntime).not.toMatch(/from ['"]autotel['"]/);
  });

  it('routes server and client through the runtime shim, not Node autotel', () => {
    for (const file of ['server.ts', 'client.ts', 'failure.ts']) {
      const source = readFileSync(path.join(root, 'src', file), 'utf8');
      expect(source).not.toMatch(/^import\s+[^;]*from ['"]autotel['"]/m);
      expect(source).toMatch(/from ['"]#runtime['"]/);
    }
  });

  it('declares optional peers and resolves #runtime to autotel-edge under Workers conditions', () => {
    const edge = {
      import: './dist/runtime.edge.js',
      require: './dist/runtime.edge.cjs',
    };
    expect(
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
    ).toMatchObject({
      peerDependencies: { 'autotel-edge': expect.any(String) },
      peerDependenciesMeta: {
        autotel: { optional: true },
        'autotel-edge': { optional: true },
      },
      imports: {
        '#runtime': {
          workerd: edge,
          worker: edge,
          browser: edge,
          import: './dist/runtime.js',
          require: './dist/runtime.cjs',
        },
      },
    });
  });
});
