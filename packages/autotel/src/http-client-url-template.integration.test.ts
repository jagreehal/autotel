import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { it } from 'vitest';

const run = promisify(execFile);

it('names http and fetch client spans through the real instrumentations', async () => {
  // A child process, so the instrumentations patch node:http and undici
  // before anything loads them. The fixture asserts on the exported spans.
  await run(
    process.execPath,
    ['--import', 'tsx', 'test/http-client-url-template.ts'],
    {
      cwd: new URL('../../../apps/example-http/', import.meta.url),
      timeout: 20_000,
      env: { ...process.env, AUTOTEL_DEVTOOLS: 'off' },
    },
  );
});
