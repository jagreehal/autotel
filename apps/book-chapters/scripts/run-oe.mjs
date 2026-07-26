import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const examples = readdirSync(new URL('../examples', import.meta.url))
  .filter((name) => name.startsWith('oe-') && name.endsWith('.ts'))
  .sort();

if (examples.length === 0) {
  throw new Error('No observability-engineering examples found');
}

for (const example of examples) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', `examples/${example}`],
    {
      cwd: new URL('..', import.meta.url),
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) process.exit(result.status ?? 1);
}
