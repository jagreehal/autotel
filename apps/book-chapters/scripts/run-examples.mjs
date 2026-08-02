import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// Optional filename prefix: `run-examples.mjs oe-` runs only the
// Observability Engineering concept examples. No arg runs everything.
const prefix = process.argv[2] ?? '';

const examples = readdirSync(new URL('../examples', import.meta.url))
  // `_`-prefixed files are shared helpers, not chapters.
  .filter(
    (name) =>
      !name.startsWith('_') && name.startsWith(prefix) && name.endsWith('.ts'),
  )
  .sort();

if (examples.length === 0) {
  throw new Error(`No examples matching "${prefix}"`);
}

for (const example of examples) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', `examples/${example}`],
    { cwd: new URL('..', import.meta.url), stdio: 'inherit' },
  );

  if (result.status !== 0) process.exit(result.status ?? 1);
}
