import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { it } from 'vitest';

const run = promisify(execFile);

it.each(['defaults', 'layers'])(
  'inherits request attributes through real Express and HTTP instrumentation (%s)',
  async (mode) => {
    // Isolate module loading: instrumentation must register before Express.
    // The fixture uses the HTTP example's existing Express dependency.
    await run(
      process.execPath,
      ['--import', 'tsx', 'test/request-context.ts', mode],
      {
        cwd: new URL('../../../apps/example-http/', import.meta.url),
        timeout: 20_000,
        env: { ...process.env, AUTOTEL_DEVTOOLS: 'off' },
      },
    );
  },
);
