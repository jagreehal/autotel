// npm trusted publishing (see .github/workflows/release.yml) can only publish a
// package name that already exists on the registry — the trusted publisher is
// configured on the package's npmjs.com settings page. A brand-new package
// therefore fails the release with E404 *after* changesets has consumed its
// changeset. Catch it here, on the PR that adds the package, instead.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const packages = JSON.parse(
  execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
    encoding: 'utf8',
  }),
).filter((p) => !p.private && p.name !== 'autotel-monorepo');

// Apache-2.0 s4(a)/4(d): every published tarball must carry the licence and the
// NOTICE (which is where the trademark reservation lives). npm auto-includes
// LICENSE but not NOTICE, so both need a "files" entry.
const unlicensed = [];
for (const { name, path } of packages) {
  const files =
    JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).files ?? [];
  for (const f of ['LICENSE', 'NOTICE']) {
    if (!existsSync(join(path, f))) unlicensed.push(`${name}: no ${f} file`);
    else if (!files.includes(f))
      unlicensed.push(`${name}: ${f} not in "files"`);
  }
}

if (unlicensed.length > 0) {
  console.error(
    `Publishable packages missing licence text:\n  ${unlicensed.join('\n  ')}\n\n` +
      `Copy the root LICENSE and NOTICE into each package directory and add\n` +
      `both to its "files" array, so they ship in the published tarball.`,
  );
  process.exit(1);
}

const missing = [];
for (const { name } of packages) {
  const res = await fetch(`https://registry.npmjs.org/${name}`, {
    method: 'HEAD',
  });
  if (res.status === 404) missing.push(name);
  else if (!res.ok) throw new Error(`registry ${res.status} for ${name}`);
}

if (missing.length > 0) {
  console.error(
    `Not on npm yet: ${missing.join(', ')}\n\n` +
      `Release uses npm trusted publishing, which cannot create a new package name.\n` +
      `Bootstrap each one before merging:\n` +
      `  1. pnpm --filter <name> build\n` +
      `  2. pnpm --filter <name> publish --access public --no-git-checks\n` +
      `  3. npmjs.com > package > Settings > Trusted publisher:\n` +
      `     jagreehal/autotel, workflow release.yml, environment release\n\n` +
      `Or mark the package "private": true if it is not meant to be published.`,
  );
  process.exit(1);
}

console.log(
  `${packages.length} publishable packages, all licensed and present on npm.`,
);
