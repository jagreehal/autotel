// Every name a skill imports from a workspace package has to be exported by it.
//
// Skills are read by agents, which copy the imports verbatim. `useLogger` from
// 'autotel', `TailSamplingProcessor` from 'autotel/processors' and
// `OTLPHttpJsonExporter` were all in skills while no package exported them, so
// the generated code failed to compile. Nothing type-checks Markdown.
//
// Works from source, no build needed: a subpath resolves through the package's
// exports map, and the dist target maps back to src (dist/foo.js ->
// src/foo.ts or src/foo/index.ts). Exports are followed through `export *` and
// `export { x } from` re-exports.
//
// Deliberately wrong examples are skipped: a block whose nearest preceding
// non-blank line says "Wrong" (the `Wrong:` convention), or one containing a
// `// wrong` comment.
//
// Usage: node scripts/check-skill-imports.mjs [rootDir]
//        node scripts/check-skill-imports.mjs --self-test
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CODE_LANGS = new Set([
  'ts',
  'typescript',
  'js',
  'javascript',
  'tsx',
  'jsx',
  'mjs',
]);
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx'];

function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name), ext)
      : e.name.endsWith(ext)
        ? [join(dir, e.name)]
        : [],
  );
}

/** Every target under an exports entry, across conditions (browser, import, ...). */
function targets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object')
    return Object.values(value).flatMap(targets);
  return [];
}

function tryFile(base) {
  for (const ext of ['', ...SOURCE_EXTS]) {
    const file = base + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return undefined;
}

/** Source files behind `pkg` + subpath ('.' or './x'); empty if not exported. */
function resolveEntries(pkgDir, manifest, subpath) {
  const exportsMap =
    typeof manifest.exports === 'string'
      ? { '.': manifest.exports }
      : (manifest.exports ?? { '.': manifest.main ?? './dist/index.js' });
  let found = targets(exportsMap[subpath]);
  if (found.length === 0) {
    for (const [key, value] of Object.entries(exportsMap)) {
      const star = key.indexOf('*');
      if (star === -1) continue;
      const [pre, post] = [key.slice(0, star), key.slice(star + 1)];
      if (subpath.startsWith(pre) && subpath.endsWith(post)) {
        const hit = subpath.slice(pre.length, subpath.length - post.length);
        found = targets(value).map((t) => t.replace('*', hit));
        break;
      }
    }
  }
  const files = found.map((target) => {
    const bare = target
      .replace(/^\.\/(dist|build|lib)\//, './src/')
      .replace(/\.d\.(c|m)?ts$|\.(c|m)?js$/, '');
    return tryFile(join(pkgDir, bare)) ?? tryFile(join(pkgDir, target));
  });
  return [...new Set(files.filter(Boolean))];
}

/** Names a module exports; '*' in the set means "unknowable, accept anything". */
function exportedNames(file, seen = new Set()) {
  const names = new Set();
  if (seen.has(file)) return names;
  seen.add(file);
  // Drop comments, keeping strings intact so a glob like '**/*' isn't read as one.
  const src = readFileSync(file, 'utf8').replace(
    /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, string) => string ?? '',
  );

  for (const m of src.matchAll(
    /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum|namespace)\s+([\w$]+)/g,
  ))
    names.add(m[1]);
  if (/\bexport\s+default\b/.test(src)) names.add('default');
  for (const m of src.matchAll(
    /\bexport\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g,
  ))
    for (const n of splitNames(m[1])) names.add(n.exported);
  for (const m of src.matchAll(/\bexport\s+\*\s+as\s+([\w$]+)\s+from/g))
    names.add(m[1]);
  for (const m of src.matchAll(
    /\bexport\s+(?:type\s+)?\*\s+from\s*['"]([^'"]+)['"]/g,
  )) {
    const spec = m[1];
    if (!spec.startsWith('.')) {
      names.add('*'); // re-exports a dependency wholesale; can't verify
      continue;
    }
    const next = tryFile(join(dirname(file), spec).replace(/\.(c|m)?js$/, ''));
    if (next) for (const n of exportedNames(next, seen)) names.add(n);
  }
  return names;
}

/** `a, b as c, type T` -> [{ imported: 'a', exported: 'a' }, ...] */
function splitNames(list) {
  return list
    .replace(/\/\/.*$/gm, '')
    .split(',')
    .map((s) => s.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((s) => {
      const [imported, exported = imported] = s.split(/\s+as\s+/);
      return { imported: imported.trim(), exported: exported.trim() };
    });
}

/** Fenced JS/TS blocks: { code, line } where line is the first code line. */
function codeBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(```+|~~~+)\s*([\w-]*)/);
    if (!open) continue;
    const fence = open[1];
    let end = i + 1;
    while (end < lines.length && !lines[end].trim().startsWith(fence)) end++;
    const code = lines.slice(i + 1, end).join('\n');
    let prev = i - 1;
    while (prev >= 0 && lines[prev].trim() === '') prev--;
    const markedWrong =
      (prev >= 0 && /\bwrong\b/i.test(lines[prev])) ||
      /\/\/\s*wrong\b/i.test(code);
    if (CODE_LANGS.has(open[2].toLowerCase()) && !markedWrong)
      blocks.push({ code, line: i + 2 });
    i = end;
  }
  return blocks;
}

/**
 * @returns {{ file: string, line: number, spec: string, name?: string, problem: string }[]}
 */
export function findBadSkillImports(rootDir) {
  const packages = new Map(); // name -> { dir, manifest }
  const packagesDir = join(rootDir, 'packages');
  for (const dirName of existsSync(packagesDir)
    ? readdirSync(packagesDir)
    : []) {
    const dir = join(packagesDir, dirName);
    if (!existsSync(join(dir, 'package.json'))) continue;
    const manifest = JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8'),
    );
    if (manifest.name) packages.set(manifest.name, { dir, manifest });
  }
  const cache = new Map(); // spec -> Set | null
  const exportsOf = (spec) => {
    if (cache.has(spec)) return cache.get(spec);
    const name = [...packages.keys()]
      .filter((n) => spec === n || spec.startsWith(n + '/'))
      .sort((a, b) => b.length - a.length)[0];
    let result;
    if (!name)
      result = undefined; // not a workspace package
    else {
      const { dir, manifest } = packages.get(name);
      const entries = resolveEntries(
        dir,
        manifest,
        '.' + spec.slice(name.length),
      );
      result =
        entries.length > 0
          ? new Set(entries.flatMap((entry) => [...exportedNames(entry)]))
          : null;
    }
    cache.set(spec, result);
    return result;
  };

  const problems = [];
  for (const file of walk(join(rootDir, 'skills'), '.md')) {
    const rel = relative(rootDir, file);
    for (const { code, line } of codeBlocks(readFileSync(file, 'utf8'))) {
      const lineOf = (index) =>
        line + code.slice(0, index).split('\n').length - 1;
      const re =
        /\b(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?(?:\{([^}]*)\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s*from\s*['"]([^'"]+)['"]/g;
      for (const m of code.matchAll(re)) {
        const [, list, spec] = m;
        const names = exportsOf(spec);
        if (names === undefined) continue;
        const at = { file: rel, line: lineOf(m.index), spec };
        if (names === null) {
          problems.push({ ...at, problem: 'subpath not in exports map' });
          continue;
        }
        if (!list || names.has('*')) continue;
        for (const { imported } of splitNames(list))
          if (!names.has(imported))
            problems.push({ ...at, name: imported, problem: 'not exported' });
      }
    }
  }
  return problems;
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'skill-imports-'));
  const pkg = join(root, 'packages', 'lib');
  mkdirSync(join(pkg, 'src', 'sub'), { recursive: true });
  mkdirSync(join(root, 'skills', 'x'), { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: 'lib',
      exports: {
        '.': { import: { types: './dist/index.d.ts' } },
        './sub': './dist/sub/index.js',
      },
    }),
  );
  writeFileSync(
    join(pkg, 'src', 'index.ts'),
    "export const a = 1;\nexport * from './more.js';\nexport { c as d } from './more.js';\n",
  );
  writeFileSync(
    join(pkg, 'src', 'more.ts'),
    'export function b() {}\nexport interface T {}\nconst c = 1;\nexport { c };\n',
  );
  writeFileSync(join(pkg, 'src', 'sub', 'index.ts'), 'export class S {}\n');
  const fence = '```';
  writeFileSync(
    join(root, 'skills', 'x', 'SKILL.md'),
    [
      `${fence}ts`,
      "import {\n  a,\n  b as bb,\n  type T,\n  d,\n} from 'lib';",
      "import { S } from 'lib/sub';",
      "import { nope } from 'lib';",
      "import { z } from 'lib/missing';",
      "import { anything } from 'not-workspace';",
      fence,
      'Wrong:',
      '',
      `${fence}ts`,
      "import { alsoNope } from 'lib';",
      fence,
      `${fence}bash`,
      "import { ignored } from 'lib';",
      fence,
    ].join('\n'),
  );

  const found = findBadSkillImports(root).map(
    ({ line, spec, name, problem }) => ({ line, spec, name, problem }),
  );
  const expected = [
    { line: 9, spec: 'lib', name: 'nope', problem: 'not exported' },
    {
      line: 10,
      spec: 'lib/missing',
      name: undefined,
      problem: 'subpath not in exports map',
    },
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
    'self-test passed: one missing name and one unknown subpath found, the rest ignored.',
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
    const problems = findBadSkillImports(root);
    if (problems.length > 0) {
      console.error('Skill imports that do not resolve:\n');
      for (const { file, line, spec, name, problem } of problems) {
        console.error(
          `  ${file}:${line}  '${spec}'${name ? ` { ${name} }` : ''}  ${problem}`,
        );
      }
      console.error(
        `\n${problems.length} problem(s). Fix the import in the skill, or mark a` +
          ' deliberately broken example with "Wrong:" before the block.',
      );
      process.exit(1);
    }
    console.log('Every workspace import in skills/ resolves to an export.');
  }
}
