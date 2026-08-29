// Every subpath a package advertises has to resolve to a file the build wrote.
//
// `autotel-subscribers/testing` and `autotel-web/privacy` were both declared in
// their exports maps and never emitted by tsdown, so importing either one threw
// ERR_MODULE_NOT_FOUND for every consumer while every test in the repo passed.
// Nothing else checks this: the exports map is data, and a missing entry point
// only fails at someone else's import.
//
// Run after a build. A package with no dist/ is treated as unbuilt and skipped,
// so this is a check on the publish surface rather than on build order.
//
// Usage: node scripts/check-exports-map.mjs [rootDir]
//        node scripts/check-exports-map.mjs --self-test
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Every file path an exports/bin/main entry points at, flattened. */
function targets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object')
    return Object.values(value).flatMap(targets);
  return [];
}

/**
 * @returns {{ pkg: string, entry: string, target: string }[]} one row per
 * declared path that does not exist on disk.
 */
export function findMissingExportTargets(rootDir) {
  const packagesDir = join(rootDir, 'packages');
  if (!existsSync(packagesDir)) return [];
  const missing = [];

  for (const name of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, name);
    const manifest = join(pkgDir, 'package.json');
    if (!existsSync(manifest)) continue;

    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    // Unbuilt: nothing to check yet, and complaining here would only teach
    // people to ignore this script.
    if (!existsSync(join(pkgDir, 'dist'))) continue;

    const declared = [
      ...Object.entries(pkg.exports ?? {}).map(([entry, value]) => [
        entry,
        value,
      ]),
      ...(pkg.bin ? [['bin', pkg.bin]] : []),
      ...(pkg.main ? [['main', pkg.main]] : []),
      ...(pkg.module ? [['module', pkg.module]] : []),
      ...(pkg.types ? [['types', pkg.types]] : []),
    ];

    for (const [entry, value] of declared) {
      for (const target of targets(value)) {
        if (!target.startsWith('./')) continue;
        // A subpath pattern (`./schemas/*.json`) names a set, not a file. The
        // directory it reads from is the part that can be missing.
        const probe = target.includes('*')
          ? target.slice(0, target.indexOf('*'))
          : target;
        if (!existsSync(join(pkgDir, probe))) {
          missing.push({ pkg: pkg.name ?? name, entry, target });
        }
      }
    }
  }

  return missing;
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'exports-check-'));
  const good = join(root, 'packages', 'good');
  const bad = join(root, 'packages', 'bad');
  mkdirSync(join(good, 'dist'), { recursive: true });
  mkdirSync(join(bad, 'dist'), { recursive: true });
  writeFileSync(join(good, 'dist', 'index.js'), '');
  writeFileSync(join(bad, 'dist', 'index.js'), '');
  writeFileSync(
    join(good, 'package.json'),
    JSON.stringify({
      name: 'good',
      exports: { '.': { import: './dist/index.js' } },
    }),
  );
  writeFileSync(
    join(bad, 'package.json'),
    JSON.stringify({
      name: 'bad',
      exports: {
        '.': { import: './dist/index.js' },
        './testing': { import: './dist/testing/index.js' },
      },
    }),
  );

  const found = findMissingExportTargets(root);
  const expected = [
    { pkg: 'bad', entry: './testing', target: './dist/testing/index.js' },
  ];
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    console.error(
      'self-test failed\n  expected:',
      expected,
      '\n  found:   ',
      found,
    );
    process.exit(1);
  }
  console.log(
    'self-test passed: one broken subpath found, the sound one ignored.',
  );
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const root =
      process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
    const missing = findMissingExportTargets(root);
    if (missing.length > 0) {
      console.error('Declared entry points that do not exist:\n');
      for (const { pkg, entry, target } of missing) {
        console.error(`  ${pkg} "${entry}" -> ${target}`);
      }
      console.error(
        '\nEach one throws ERR_MODULE_NOT_FOUND on import. Add the entry to the' +
          " package's tsdown config, or drop it from the exports map.",
      );
      process.exit(1);
    }
    console.log('Every declared entry point resolves to a built file.');
  }
}
