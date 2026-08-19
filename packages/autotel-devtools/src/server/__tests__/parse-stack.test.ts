import { describe, it, expect } from 'vitest';
import { parseStackTrace } from '../parse-stack';

// Captured from a real `node` run rather than hand-written, so the shapes below
// (file:// URLs, `async` prefixes, node: internals) are the ones V8 actually
// emits instead of the ones we imagine it emits.
const REAL_ESM_STACK =
  'TypeError: cannot read property x of undefined\n' +
  '    at deep (file:///tmp/scratch/stackgen.mjs:2:9)\n' +
  '    at middle (file:///tmp/scratch/stackgen.mjs:5:9)\n' +
  '    at top (file:///tmp/scratch/stackgen.mjs:8:10)\n' +
  '    at file:///tmp/scratch/stackgen.mjs:11:9\n' +
  '    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)\n' +
  '    at async node:internal/modules/esm/loader:633:26\n' +
  '    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)';

// Also captured from a real run — note the pnpm layout, where the package name
// appears twice and `node_modules` is not the first path segment.
const REAL_DEPENDENCY_STACK =
  'Error: getaddrinfo ENOTFOUND example.com\n' +
  '    at emitErrorAndClose (/Users/j/proj/node_modules/.pnpm/ws@8.21.3/node_modules/ws/lib/websocket.js:1060:13)\n' +
  '    at ClientRequest.emit (node:events:509:28)\n' +
  '    at emitErrorNT (node:internal/streams/destroy:170:8)';

describe('parseStackTrace', () => {
  it('parses a named frame into function, file, line and column', () => {
    const frames = parseStackTrace(REAL_ESM_STACK);

    expect(frames[0]).toMatchObject({
      function: 'deep',
      file: '/tmp/scratch/stackgen.mjs',
      line: 2,
      column: 9,
    });
  });

  it('keeps anonymous frames, with a position but no function name', () => {
    const frames = parseStackTrace(REAL_ESM_STACK);

    // 4th line of the stack is `at file:///tmp/scratch/stackgen.mjs:11:9`.
    const anon = frames.find((f) => f.line === 11);

    expect(anon).toMatchObject({
      file: '/tmp/scratch/stackgen.mjs',
      column: 9,
    });
    expect(anon?.function).toBeUndefined();
  });

  it('strips the `async` marker instead of folding it into the name or path', () => {
    const frames = parseStackTrace(REAL_ESM_STACK);

    const asyncNamed = frames.find((f) => f.line === 101);
    expect(asyncNamed?.function).toBe('asyncRunEntryPointWithESMLoader');

    const asyncAnon = frames.find((f) => f.line === 633);
    expect(asyncAnon?.file).toBe('node:internal/modules/esm/loader');
  });

  it('decodes a Windows file URL and a percent-escaped path', () => {
    const frames = parseStackTrace(
      '    at handler (file:///C:/Users/dev/My%20App/src/index.ts:7:3)',
    );

    expect(frames[0]).toMatchObject({
      file: 'C:/Users/dev/My App/src/index.ts',
      line: 7,
    });
  });

  it('separates your code from dependency and runtime frames', () => {
    const [dependency, native] = parseStackTrace(REAL_DEPENDENCY_STACK);

    expect(dependency.kind).toBe('dependency');
    expect(native.kind).toBe('native');

    const [app] = parseStackTrace(REAL_ESM_STACK);
    expect(app.kind).toBe('app');
  });
});
