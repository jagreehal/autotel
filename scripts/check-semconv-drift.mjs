// Every telemetry name autotel emits is either an OpenTelemetry one or ours.
//
// The `semconv.ts` / `attrs.ts` / `attributes.ts` files are hand-maintained
// string tables, and their tests only assert self-consistency: `semconv.test.ts`
// checks that gen_ai keys start with `gen_ai.`, not that they still exist
// upstream. So a rename or deprecation in a semconv release lands silently and
// the first symptom is a query that returns nothing in someone's backend.
//
// This checks each name against the registry shipped by
// @opentelemetry/semantic-conventions (already a dependency; attribute keys,
// metric names, event names and enum values are all exported as constants), and
// reports three things:
//
//   unknown     not upstream, not in scripts/semconv-extensions.json. Either a
//               typo, an upstream removal, or a new extension nobody declared.
//   deprecated  upstream, but marked @deprecated. Carries the replacement.
//   adopted     declared as ours, but upstream now defines it too. Check the
//               semantics match and drop the extension entry.
//
// An entry in scripts/semconv-extensions.json means "we own this name, or we
// knowingly keep it", so it silences all three. The value is the reason, and it
// is the reason a reviewer reads on the diff that adds one.
//
// Only dotted names are considered. Bare values (`chat`, `anthropic`) are enum
// members whose spelling is already pinned by the packages' own tests.
//
// Usage: node scripts/check-semconv-drift.mjs [rootDir]
//        node scripts/check-semconv-drift.mjs --self-test
//        node scripts/check-semconv-drift.mjs --update   (rewrite extensions)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DOTTED = /^[a-z][a-z\d_]*(\.[a-z\d_]+)+$/;

/**
 * @param {{ pkg: string, file: string, names: string[] }[]} sources
 * @param {{ names: Set<string>, deprecated: Map<string, string> }} registry
 * @param {Record<string, string>} extensions declared name -> why it is ours
 * @returns {{ kind: 'unknown'|'deprecated'|'adopted', name: string, pkg: string, file: string, note: string }[]}
 */
export function findSemconvDrift(sources, registry, extensions) {
  /** @type {Record<string, any[]>} */
  const byKind = { unknown: [], deprecated: [], adopted: [] };

  for (const { pkg, file, names } of sources) {
    for (const name of new Set(names)) {
      // Bare values are enum members, not keys. Their spelling is pinned by the
      // packages' own tests and checking them here is all false positives.
      if (!DOTTED.test(name)) continue;
      const declared = Object.hasOwn(extensions, name);

      if (!registry.names.has(name)) {
        if (!declared) {
          byKind.unknown.push({
            kind: 'unknown',
            name,
            pkg,
            file,
            note: 'not in semconv and not declared in scripts/semconv-extensions.json',
          });
        }
        continue;
      }

      const replacement = registry.deprecated.get(name);
      if (replacement && !declared) {
        byKind.deprecated.push({
          kind: 'deprecated',
          name,
          pkg,
          file,
          note: replacement,
        });
      }
      if (declared && !replacement) {
        byKind.adopted.push({
          kind: 'adopted',
          name,
          pkg,
          file,
          note: 'upstream now defines this; drop the extensions entry',
        });
      }
    }
  }

  // Severity order: a name nobody recognises is worse than one upstream renamed,
  // which is worse than one upstream caught up with.
  return [...byKind.unknown, ...byKind.deprecated, ...byKind.adopted];
}

function selfTest() {
  const registry = {
    names: new Set(['server.address', 'db.connection_string', 'rpc.system']),
    deprecated: new Map([
      ['db.connection_string', 'Replaced by `server.address`.'],
      ['rpc.system', 'Replaced by `rpc.system.name`.'],
    ]),
  };
  const extensions = {
    'autotel.cost.usd': 'ours: no upstream cost attribute',
    'server.address': 'stale entry, upstream defines this',
    'rpc.system': 'deprecated upstream, kept on purpose until the next major',
  };
  const sources = [
    {
      pkg: 'a',
      file: 'a/src/semconv.ts',
      names: [
        'server.address', // upstream + stale extension entry -> adopted
        'db.connection_string', // upstream, deprecated -> deprecated
        'autotel.cost.usd', // declared ours -> clean
        'gen_ai.usage.input_token', // typo, undeclared -> unknown
        'rpc.system', // deprecated but declared on purpose -> clean
        'chat', // bare enum value -> out of scope
      ],
    },
  ];

  const found = findSemconvDrift(sources, registry, extensions);
  const expected = [
    {
      kind: 'unknown',
      name: 'gen_ai.usage.input_token',
      pkg: 'a',
      file: 'a/src/semconv.ts',
      note: 'not in semconv and not declared in scripts/semconv-extensions.json',
    },
    {
      kind: 'deprecated',
      name: 'db.connection_string',
      pkg: 'a',
      file: 'a/src/semconv.ts',
      note: 'Replaced by `server.address`.',
    },
    {
      kind: 'adopted',
      name: 'server.address',
      pkg: 'a',
      file: 'a/src/semconv.ts',
      note: 'upstream now defines this; drop the extensions entry',
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
  const parsed = genaiRegistryNames(
    [
      'groups:',
      '  - attributes:',
      '    - key: gen_ai.provider.name',
      '      type:',
      '        members:',
      '        - value: anthropic',
      '    metric_name: gen_ai.client.token.usage',
      '    name: gen_ai.client.inference.operation.details',
      '      brief: not a name field',
    ].join('\n'),
  );
  const expectedNames = [
    'anthropic',
    'gen_ai.client.inference.operation.details',
    'gen_ai.client.token.usage',
    'gen_ai.provider.name',
  ];
  if (
    JSON.stringify([...parsed].toSorted()) !== JSON.stringify(expectedNames)
  ) {
    console.error(
      'self-test failed: registry parse\n  expected:',
      expectedNames,
      '\n  found:   ',
      [...parsed].toSorted(),
    );
    process.exit(1);
  }

  console.log(
    'self-test passed: typo, deprecation and adoption caught; declared extension and bare enum value ignored; registry yaml parsed.',
  );
}

const NAME_FILES = new Set([
  'semconv.ts',
  'semantic-conventions.ts',
  'attrs.ts',
  'attributes.ts',
  'validation-attributes.ts',
]);

/**
 * Every string literal in the repo's hand-maintained name tables.
 *
 * Reads source rather than `dist/`, so this runs before a build and cannot be
 * fooled by a stale artifact.
 */
export function collectSemconvSources(rootDir) {
  const packagesDir = join(rootDir, 'packages');
  if (!existsSync(packagesDir)) return [];
  const sources = [];

  const walk = (dir, pkg) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist')
          walk(full, pkg);
        continue;
      }
      if (!NAME_FILES.has(entry.name)) continue;
      const src = readFileSync(full, 'utf8');
      sources.push({
        pkg,
        file: relative(rootDir, full),
        names: [...src.matchAll(/'([^'\\\n]*)'/g)].map((m) => m[1]),
      });
    }
  };

  for (const name of readdirSync(packagesDir)) {
    const src = join(packagesDir, name, 'src');
    if (existsSync(src)) walk(src, name);
  }
  return sources.toSorted((a, b) => a.file.localeCompare(b.file));
}

/**
 * The upstream surface, from the copy of @opentelemetry/semantic-conventions
 * the packages already resolve. Attribute keys, metric names, event names and
 * enum values are all exported as constants, so `Object.values` is the registry.
 *
 * Deprecations only exist in the jsdoc, so they come from the `.d.ts`.
 */
/**
 * Names declared by a resolved semantic-convention registry (weaver's
 * `schema-snapshot/registry.yaml`): attribute keys, metric and event names, and
 * enum member values.
 */
export function genaiRegistryNames(yaml) {
  const names = new Set();
  for (const pattern of [
    /^\s*(?:- )?key: (\S+)$/gm,
    /^\s*(?:- )?metric_name: (\S+)$/gm,
    /^\s*(?:- )?name: (\S+)$/gm,
    /^\s*(?:- )?value: ["']?([A-Za-z][\w./-]*)["']?$/gm,
  ]) {
    for (const m of yaml.matchAll(pattern)) names.add(m[1]);
  }
  return names;
}

export function loadRegistry(rootDir) {
  const require = createRequire(
    join(rootDir, 'packages', 'autotel', 'noop.js'),
  );
  const entry = require.resolve('@opentelemetry/semantic-conventions');
  const names = new Set(
    [
      ...Object.values(require('@opentelemetry/semantic-conventions')),
      ...Object.values(
        require('@opentelemetry/semantic-conventions/incubating'),
      ),
    ].filter((v) => typeof v === 'string'),
  );

  const deprecated = new Map();
  const buildDir = dirname(entry);
  for (const file of readdirSync(buildDir)) {
    if (!file.endsWith('.d.ts')) continue;
    const text = readFileSync(join(buildDir, file), 'utf8');
    // A jsdoc block carrying @deprecated, then the const it documents.
    for (const m of text.matchAll(
      /@deprecated ([^\n]*)[\S\s]*?export declare const \w+: "([^"]+)"/g,
    )) {
      deprecated.set(m[2], m[1].trim());
    }
  }

  // semconv 1.43 moved gen_ai.* / mcp.* out to their own registry and left the
  // originals marked @deprecated. They are not deprecated, they are elsewhere,
  // so the snapshot of that registry both defines them and clears the marker.
  const genai = JSON.parse(
    readFileSync(
      join(rootDir, 'scripts', 'semconv-genai-registry.json'),
      'utf8',
    ),
  );
  for (const name of genai.names) {
    names.add(name);
    deprecated.delete(name);
  }

  return { names, deprecated };
}

function extensionsPath(rootDir) {
  return join(rootDir, 'scripts', 'semconv-extensions.json');
}

function readExtensions(rootDir) {
  const file = extensionsPath(rootDir);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const root =
      process.argv.find(
        (a) =>
          !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1],
      ) ?? join(dirname(fileURLToPath(import.meta.url)), '..');
    const registry = loadRegistry(root);
    const sources = collectSemconvSources(root);
    const extensions = readExtensions(root);
    const findings = findSemconvDrift(sources, registry, extensions);

    const regen = process.argv.indexOf('--update-genai');
    if (regen !== -1) {
      const yaml = readFileSync(
        join(process.argv[regen + 1], 'schema-snapshot', 'registry.yaml'),
        'utf8',
      );
      const manifest = readFileSync(
        join(process.argv[regen + 1], 'model', 'manifest.yaml'),
        'utf8',
      );
      const file = join(root, 'scripts', 'semconv-genai-registry.json');
      const existing = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(
        file,
        `${JSON.stringify(
          {
            ...existing,
            schema_url:
              /schema_url: (\S+)/.exec(manifest)?.[1] ?? existing.schema_url,
            names: [...genaiRegistryNames(yaml)].toSorted(),
          },
          undefined,
          2,
        )}\n`,
      );
      console.log('Refreshed scripts/semconv-genai-registry.json.');
    } else if (process.argv.includes('--update')) {
      // Adopt the current state as declared: every unknown name becomes an
      // extension entry. Deliberate one-off, so the next real drift is a diff.
      const next = { ...extensions };
      for (const { name, pkg } of findings.filter((f) => f.kind === 'unknown'))
        next[name] ??= `autotel extension (${pkg})`;
      for (const { name } of findings.filter((f) => f.kind === 'adopted'))
        delete next[name];
      const sorted = Object.fromEntries(
        Object.keys(next)
          .toSorted()
          .map((k) => [k, next[k]]),
      );
      writeFileSync(
        extensionsPath(root),
        `${JSON.stringify(sorted, undefined, 2)}\n`,
      );
      console.log(
        `Wrote ${Object.keys(sorted).length} declared extensions to scripts/semconv-extensions.json.`,
      );
    } else if (findings.length > 0) {
      const label = {
        unknown: 'Not in semconv and not declared',
        deprecated: 'Deprecated upstream',
        adopted: 'Now defined upstream',
      };
      for (const kind of ['unknown', 'deprecated', 'adopted']) {
        const rows = findings.filter((f) => f.kind === kind);
        if (rows.length === 0) continue;
        console.error(`\n${label[kind]}:\n`);
        for (const { name, file, note } of rows)
          console.error(`  ${name}\n    ${file}\n    ${note}`);
      }
      console.error(
        '\nFix the name, or declare it in scripts/semconv-extensions.json with a' +
          ' reason (`--update` adopts them all at once).',
      );
      process.exit(1);
    } else {
      console.log(
        `Every dotted name in ${sources.length} name tables is upstream semconv or a declared extension.`,
      );
    }
  }
}
