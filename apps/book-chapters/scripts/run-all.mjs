import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const chapters = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '30',
  '31',
  '38',
  '45',
  '46',
];

for (const chapter of chapters) {
  const example = readdirSync(new URL('../examples', import.meta.url)).find(
    (name) => name.startsWith(`${chapter}-`) && name.endsWith('.ts'),
  );
  if (!example) {
    throw new Error(`No example found for chapter ${chapter}`);
  }
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', `examples/${example}`],
    {
      cwd: new URL('..', import.meta.url),
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
