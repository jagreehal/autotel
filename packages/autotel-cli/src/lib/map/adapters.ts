import * as path from 'node:path';
import { globSync } from 'glob';
import {
  SyntaxKind,
  ts,
  type CallExpression,
  type Node,
  type SourceFile,
  type VariableDeclaration,
} from 'ts-morph';
import {
  AMBIENT_APIS,
  moduleBindings,
  relativeFile,
  type Parser,
} from './facts';
import { fileExists, readFileSafe } from '../fs';
import type {
  Framework,
  RawRouteEntry,
  RouteKind,
  SourceLocation,
} from './types';

export interface AdapterContext {
  projectRoot: string;
  parse: Parser;
}

export interface FrameworkAdapter {
  framework: Framework;
  /** Names the framework injects without an import, e.g. Nitro's `useLogger`. */
  autoImports: readonly string[];
  extractRoutes: (context: AdapterContext) => RawRouteEntry[];
  /**
   * The subtree the rules should read for one entry point.
   *
   * Only frameworks that register many routes in one file implement this. For
   * file-per-route conventions the file *is* the entry point, and scoping would
   * hide the module-level `trace()` wrapping the exported handler.
   */
  scopesFor?: (
    route: RawRouteEntry,
    source: SourceFile,
  ) => readonly Node[] | undefined;
}

const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.output/**',
  '**/*.test.*',
  '**/*.spec.*',
];

function files(root: string, pattern: string): string[] {
  return globSync(pattern, {
    cwd: root,
    absolute: true,
    ignore: IGNORE,
  }).toSorted();
}

/**
 * Convert filesystem segments to a route path.
 *
 * Covers the three conventions in play at once: Next's `(group)` and
 * `[...slug]`, Nitro's `[id]`, and SvelteKit's `[id]`. They do not collide, so
 * one function is less to keep in sync than three.
 */
function segmentsToPath(segments: readonly string[]): string {
  const parts = segments
    .filter((segment) => segment.length > 0)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => {
      const catchAll = /^\[?\[\.{3}(.+?)\]\]?$/.exec(segment);
      if (catchAll) return '*';
      const dynamic = /^\[(.+?)\]$/.exec(segment);
      return dynamic ? `:${dynamic[1]}` : segment;
    });
  return `/${parts.join('/')}`.replaceAll(/\/+/g, '/').replace(/(.)\/$/, '$1');
}

function locationOf(
  node:
    { getStartLineNumber: () => number; getStart: () => number } | undefined,
  source: SourceFile | null,
): SourceLocation | null {
  if (!node || !source) return null;
  return {
    line: node.getStartLineNumber(),
    column: source.getLineAndColumnAtPos(node.getStart()).column,
  };
}

/** Exported HTTP-method handlers in a route file, with where each is declared. */
function methodExports(
  source: SourceFile,
): { method: string; handler: SourceLocation | null }[] {
  const found: { method: string; handler: SourceLocation | null }[] = [];
  for (const [name, declarations] of source.getExportedDeclarations()) {
    if (!HTTP_METHODS.has(name)) continue;
    found.push({ method: name, handler: locationOf(declarations[0], source) });
  }
  return found;
}

/** The declaration a file's default export points at. */
function defaultExportLocation(source: SourceFile): SourceLocation | null {
  const declarations = source.getExportedDeclarations().get('default');
  return locationOf(declarations?.[0], source);
}

/**
 * Calls to named APIs from one package family, resolved through aliases and
 * namespace imports. Text mentions and same-named local helpers do not count.
 */
function importedCalls(
  source: SourceFile,
  modulePrefix: string,
  canonicalNames: readonly string[],
): ReadonlyMap<string, CallExpression> {
  const names = new Set(canonicalNames);
  const locals = new Map<string, string>();
  const namespaces = new Set<string>();

  for (const { local, imported, specifier } of moduleBindings(source)) {
    if (!specifier.startsWith(modulePrefix)) continue;
    if (imported === '*') namespaces.add(local);
    else if (names.has(imported)) locals.set(local, imported);
  }

  const found = new Map<string, CallExpression>();
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (expression.isKind(SyntaxKind.Identifier)) {
      const canonical = locals.get(expression.getText());
      if (canonical && !found.has(canonical)) found.set(canonical, call);
      continue;
    }
    if (
      expression.isKind(SyntaxKind.PropertyAccessExpression) &&
      namespaces.has(expression.getExpression().getText()) &&
      names.has(expression.getName()) &&
      !found.has(expression.getName())
    ) {
      found.set(expression.getName(), call);
    }
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Next.js                                                                     */
/* -------------------------------------------------------------------------- */

function nextAppDir(root: string): string | null {
  for (const candidate of ['app', 'src/app']) {
    if (files(root, `${candidate}/**/route.{ts,tsx,js,jsx}`).length > 0) {
      return candidate;
    }
  }
  return null;
}

const nextAdapter: FrameworkAdapter = {
  framework: 'next',
  autoImports: [],
  // Hono routes found through a catch-all scope like any Hono route; Next's
  // own route files are scored whole.
  scopesFor: (route, source) =>
    route.framework === 'hono' ? routerScopes(route, source) : undefined,
  extractRoutes({ projectRoot, parse }) {
    const routes: RawRouteEntry[] = [];
    const appDir = nextAppDir(projectRoot);

    if (appDir) {
      for (const absolute of files(
        projectRoot,
        `${appDir}/**/route.{ts,tsx,js,jsx}`,
      )) {
        const relative = relativeFile(projectRoot, absolute);
        const dir = relative
          .slice(appDir.length + 1)
          .replace(/(?:^|\/)route\.[tj]sx?$/, '');
        const routePath = segmentsToPath(dir.split('/'));
        const source = parse(absolute);

        // Hono served from a catch-all: its routes, not the catch-all.
        const honoApp = source
          ? importedCalls(source, 'hono/', ['handle'])
              .get('handle')
              ?.getArguments()[0]
          : undefined;
        if (honoApp) {
          routes.push(...routerRoutes('hono', { projectRoot, parse }, honoApp));
          continue;
        }

        const methods = source ? methodExports(source) : [];
        if (methods.length === 0) {
          routes.push({
            framework: 'next',
            kind: 'api',
            method: null,
            path: routePath,
            file: relative,
            handler: null,
          });
          continue;
        }
        for (const { method, handler } of methods) {
          routes.push({
            framework: 'next',
            kind: 'api',
            method,
            path: routePath,
            file: relative,
            handler,
          });
        }
      }
    }

    for (const absolute of [
      ...files(projectRoot, 'pages/api/**/*.{ts,tsx,js,jsx}'),
      ...files(projectRoot, 'src/pages/api/**/*.{ts,tsx,js,jsx}'),
    ]) {
      const relative = relativeFile(projectRoot, absolute);
      const afterPages = relative.replace(/^(?:src\/)?pages/, '');
      const routePath = segmentsToPath(
        afterPages
          .replace(/\.[tj]sx?$/, '')
          .replace(/\/index$/, '')
          .split('/'),
      );
      const source = parse(absolute);
      routes.push({
        framework: 'next',
        kind: 'api',
        method: null,
        path: routePath,
        file: relative,
        handler: source ? defaultExportLocation(source) : null,
      });
    }

    for (const candidate of ['middleware.ts', 'src/middleware.ts']) {
      const absolute = path.join(projectRoot, candidate);
      if (!fileExists(absolute)) continue;
      const source = parse(absolute);
      routes.push({
        framework: 'next',
        kind: 'middleware',
        method: null,
        path: '/*',
        file: candidate,
        handler: source ? defaultExportLocation(source) : null,
      });
    }

    for (const appRoot of ['app', 'src/app']) {
      for (const absolute of files(
        projectRoot,
        `${appRoot}/**/page.{ts,tsx,js,jsx}`,
      )) {
        const relative = relativeFile(projectRoot, absolute);
        const dir = relative
          .slice(appRoot.length + 1)
          .replace(/(?:^|\/)page\.[tj]sx?$/, '');
        const source = parse(absolute);
        routes.push({
          framework: 'next',
          kind: 'page',
          method: null,
          path: segmentsToPath(dir.split('/')),
          file: relative,
          handler: source ? defaultExportLocation(source) : null,
        });
      }
    }

    for (const pagesRoot of ['pages', 'src/pages']) {
      for (const absolute of files(
        projectRoot,
        `${pagesRoot}/**/*.{ts,tsx,js,jsx}`,
      )) {
        const relative = relativeFile(projectRoot, absolute);
        const belowRoot = relative.slice(pagesRoot.length + 1);
        if (
          belowRoot.startsWith('api/') ||
          /^_(?:app|document|error)\.[tj]sx?$/.test(belowRoot)
        ) {
          continue;
        }
        const routePath = segmentsToPath(
          belowRoot
            .replace(/\.[tj]sx?$/, '')
            .replace(/\/index$/, '')
            .split('/'),
        );
        const source = parse(absolute);
        routes.push({
          framework: 'next',
          kind: 'page',
          method: null,
          path: routePath,
          file: relative,
          handler: source ? defaultExportLocation(source) : null,
        });
      }
    }

    return routes;
  },
};

/* -------------------------------------------------------------------------- */
/* Nitro / Nuxt                                                                */
/* -------------------------------------------------------------------------- */

/** What nitroMethodSuffix() answers with. */
interface NitroMethodSuffixResult {
  method: string | null;
  base: string;
}

/** Nitro encodes the method in the filename: `users.post.ts` is `POST /users`. */
function nitroMethodSuffix(fileName: string): NitroMethodSuffixResult {
  const match = /^(.*)\.(get|post|put|patch|delete|head|options)$/i.exec(
    fileName,
  );
  if (!match?.[1] || !match[2]) return { method: null, base: fileName };
  return { method: match[2].toUpperCase(), base: match[1] };
}

const nitroAdapter: FrameworkAdapter = {
  framework: 'nitro',
  // Nitro auto-imports autotel's Nuxt-module helpers, so a handler can use them
  // without an import statement — a rule asking "is this autotel's logger?"
  // needs to accept that as a legitimate answer.
  autoImports: ['useLogger', 'defineEventHandler'],
  extractRoutes({ projectRoot, parse }) {
    const routes: RawRouteEntry[] = [];

    const groups: { glob: string; prefix: string; kind: RouteKind }[] = [
      { glob: 'server/api/**/*.{ts,js}', prefix: 'server/api', kind: 'api' },
      {
        glob: 'server/routes/**/*.{ts,js}',
        prefix: 'server/routes',
        kind: 'api',
      },
      {
        glob: 'server/middleware/*.{ts,js}',
        prefix: 'server/middleware',
        kind: 'middleware',
      },
    ];

    for (const group of groups) {
      for (const absolute of files(projectRoot, group.glob)) {
        const relative = relativeFile(projectRoot, absolute);
        const withoutPrefix = relative
          .slice(group.prefix.length)
          .replace(/\.[tj]s$/, '');
        const segments = withoutPrefix.split('/').filter(Boolean);
        const last = segments.pop() ?? '';
        const { method, base } = nitroMethodSuffix(last);
        if (base !== 'index') segments.push(base);

        const routePath =
          group.kind === 'middleware'
            ? '/*'
            : segmentsToPath(
                group.prefix === 'server/api' ? ['api', ...segments] : segments,
              );

        const source = parse(absolute);
        routes.push({
          framework: 'nitro',
          kind: group.kind,
          method,
          path: routePath,
          file: relative,
          handler: source ? defaultExportLocation(source) : null,
        });
      }
    }

    for (const pagesRoot of ['pages', 'app/pages']) {
      for (const absolute of files(
        projectRoot,
        `${pagesRoot}/**/*.{vue,ts,tsx,js,jsx}`,
      )) {
        const relative = relativeFile(projectRoot, absolute);
        const routePath = segmentsToPath(
          relative
            .slice(pagesRoot.length + 1)
            .replace(/\.(?:vue|[tj]sx?)$/, '')
            .replace(/\/index$/, '')
            .split('/'),
        );
        const source = parse(absolute);
        routes.push({
          framework: 'nitro',
          kind: 'page',
          method: null,
          path: routePath,
          file: relative,
          handler: source ? defaultExportLocation(source) : null,
        });
      }
    }

    return routes;
  },
};

/* -------------------------------------------------------------------------- */
/* SvelteKit                                                                   */
/* -------------------------------------------------------------------------- */

const svelteKitAdapter: FrameworkAdapter = {
  framework: 'sveltekit',
  autoImports: [],
  extractRoutes({ projectRoot, parse }) {
    const routes: RawRouteEntry[] = [];

    for (const absolute of files(
      projectRoot,
      'src/routes/**/+server.{ts,js}',
    )) {
      const relative = relativeFile(projectRoot, absolute);
      const dir = relative
        .slice('src/routes'.length)
        .replace(/\/\+server\.[tj]s$/, '');
      const routePath = segmentsToPath(dir.split('/'));
      const source = parse(absolute);
      const methods = source ? methodExports(source) : [];
      if (methods.length === 0) {
        routes.push({
          framework: 'sveltekit',
          kind: 'api',
          method: null,
          path: routePath,
          file: relative,
          handler: null,
        });
        continue;
      }
      for (const { method, handler } of methods) {
        routes.push({
          framework: 'sveltekit',
          kind: 'api',
          method,
          path: routePath,
          file: relative,
          handler,
        });
      }
    }

    for (const absolute of files(
      projectRoot,
      'src/routes/**/+{page,layout}.server.{ts,js}',
    )) {
      const relative = relativeFile(projectRoot, absolute);
      const dir = relative
        .slice('src/routes'.length)
        .replace(/\/\+(?:page|layout)\.server\.[tj]s$/, '');
      const source = parse(absolute);
      routes.push({
        framework: 'sveltekit',
        kind: 'server-fn',
        method: null,
        path: segmentsToPath(dir.split('/')),
        file: relative,
        handler: source
          ? (locationOf(
              source.getExportedDeclarations().get('load')?.[0],
              source,
            ) ??
            locationOf(
              source.getExportedDeclarations().get('actions')?.[0],
              source,
            ))
          : null,
      });
    }

    for (const candidate of ['src/hooks.server.ts', 'src/hooks.server.js']) {
      if (!fileExists(path.join(projectRoot, candidate))) continue;
      const source = parse(path.join(projectRoot, candidate));
      routes.push({
        framework: 'sveltekit',
        kind: 'middleware',
        method: null,
        path: '/*',
        file: candidate,
        handler: source
          ? locationOf(
              source.getExportedDeclarations().get('handle')?.[0],
              source,
            )
          : null,
      });
    }

    for (const absolute of files(projectRoot, 'src/routes/**/+page.{ts,js}')) {
      const relative = relativeFile(projectRoot, absolute);
      const dir = relative
        .slice('src/routes'.length)
        .replace(/\/\+page\.[tj]s$/, '');
      const source = parse(absolute);
      routes.push({
        framework: 'sveltekit',
        kind: 'page',
        method: null,
        path: segmentsToPath(dir.split('/')),
        file: relative,
        handler: source
          ? locationOf(
              source.getExportedDeclarations().get('load')?.[0],
              source,
            )
          : null,
      });
    }

    return routes;
  },
};

/* -------------------------------------------------------------------------- */
/* TanStack Start                                                              */
/* -------------------------------------------------------------------------- */

const tanstackAdapter: FrameworkAdapter = {
  framework: 'tanstack-start',
  autoImports: [],
  extractRoutes({ projectRoot, parse }) {
    const routes: RawRouteEntry[] = [];

    for (const absolute of files(projectRoot, 'src/routes/**/*.{ts,tsx}')) {
      const text = readFileSafe(absolute) ?? '';
      if (!/createServerFileRoute|createServerFn|createFileRoute/.test(text)) {
        continue;
      }

      const relative = relativeFile(projectRoot, absolute);
      const dir = relative
        .slice('src/routes'.length)
        .replace(/\.[tj]sx?$/, '')
        .replace(/\/index$/, '');
      const source = parse(absolute);
      if (!source) continue;
      const calls = importedCalls(source, '@tanstack/', [
        'createServerFileRoute',
        'createServerFn',
        'createFileRoute',
      ]);
      const serverRoute = calls.get('createServerFileRoute');
      const serverFn = calls.get('createServerFn');
      const page = calls.get('createFileRoute');
      const routePath = segmentsToPath(dir.split('/'));

      if (serverRoute || serverFn) {
        routes.push({
          framework: 'tanstack-start',
          kind: serverRoute ? 'api' : 'server-fn',
          method: null,
          path: routePath,
          file: relative,
          handler: locationOf(serverRoute ?? serverFn, source),
        });
      }
      if (page) {
        routes.push({
          framework: 'tanstack-start',
          kind: 'page',
          method: null,
          path: routePath,
          file: relative,
          handler: locationOf(page, source),
        });
      }
    }

    return routes;
  },
};

/* -------------------------------------------------------------------------- */
/* Cloudflare Workers                                                          */
/* -------------------------------------------------------------------------- */

const cloudflareAdapter: FrameworkAdapter = {
  framework: 'cloudflare',
  autoImports: [],
  extractRoutes({ projectRoot, parse }) {
    for (const candidate of [
      'src/index.ts',
      'src/worker.ts',
      'src/index.js',
      'index.ts',
    ]) {
      const absolute = path.join(projectRoot, candidate);
      if (!fileExists(absolute)) continue;
      const source = parse(absolute);
      return [
        {
          framework: 'cloudflare' as const,
          kind: 'api' as const,
          method: null,
          path: '/*',
          file: candidate,
          handler: source ? defaultExportLocation(source) : null,
        },
      ];
    }
    return [];
  },
};

/* -------------------------------------------------------------------------- */
/* Router-call frameworks: Hono, Express, Fastify, Elysia                       */
/* -------------------------------------------------------------------------- */

const ROUTER_CALL =
  /\.\s*(?:get|post|put|patch|delete|all|use|route|openapi)\s*\(/;
const REGISTRATION = /\.(get|post|put|patch|delete|all|use|openapi)$/;

/**
 * Router methods that return the app they were called on (or, for `basePath`,
 * a clone sharing its routes), so `const routes = app.get(...)` is still `app`.
 */
const ROUTER_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'all',
  'on',
  'use',
  'route',
  'basePath',
  'mount',
  'openapi',
  'doc',
  'doc31',
]);

/**
 * Whether a chain root is provably a Hono app: `new Hono()`,
 * `new OpenAPIHono()`, `factory.createApp()`, or a `const` holding one,
 * local, top-level, or imported from another file.
 */
function isHonoApp(root: Node, scope: Scope, depth = 0): boolean {
  if (depth > 8) return false;
  if (root.isKind(SyntaxKind.NewExpression)) {
    return root.getExpression().getText().endsWith('Hono');
  }
  if (root.isKind(SyntaxKind.CallExpression)) {
    const callee = root.getExpression();
    return (
      callee.isKind(SyntaxKind.PropertyAccessExpression) &&
      callee.getName() === 'createApp'
    );
  }
  if (!root.isKind(SyntaxKind.Identifier)) return false;
  const declaration = root.getSymbol()?.getDeclarations()[0];
  const value =
    declaration?.isKind(SyntaxKind.VariableDeclaration) &&
    !isTopLevel(declaration)
      ? declaration.getInitializer()
      : constantOf(root, scope);
  return value !== undefined
    ? isHonoApp(chainOf(value, scope).root, scope, depth + 1)
    : false;
}

/**
 * Whether a Hono middleware path (`*`, `/api/*`, `/users/:id`) runs for every
 * URL a route template accepts. Not whether the two strings match: middleware
 * on `/users/:id` matches the text `/users/*`, yet `/users/a/b` bypasses it.
 *
 * A trailing `*` covers the rest, including nothing (`/api/*` runs for `/api`).
 * A `:param` covers one segment, so only a literal or a plain param under it.
 * A route segment that can vary in shape (`*`, `:id?`, `:path{.+}`) is covered
 * only by a trailing `*`. An optional middleware param (`:id?`) also covers its
 * absence at the end; a constrained one (`:id{[0-9]+}`) counts as covering
 * nothing. Anything unsure counts as not covered.
 */
function patternMatches(pattern: string, routePath: string): boolean {
  const segments = (p: string) => p.split('/').filter(Boolean);
  const mw = segments(pattern);
  const route = segments(routePath);
  const isParam = (s: string) => s.startsWith(':');
  const varies = (s: string) =>
    s === '*' || (isParam(s) && (s.endsWith('?') || s.includes('{')));

  for (let i = 0; ; i++) {
    const m = mw[i];
    const r = route[i];
    const last = i === mw.length - 1;
    if (m === '*' && last) return true;
    if (r === undefined) return m === undefined || (last && m.endsWith('?'));
    if (m === undefined || varies(r)) return false;
    if (m === '*') continue;
    if (isParam(m)) {
      if (m.includes('{')) return false;
      continue;
    }
    if (m !== r) return false;
  }
}

/** Hono's joining of a mount prefix and a route path: `/users` + `/` is `/users`. */
function joinPath(prefix: string, routePath: string): string {
  if (!prefix || prefix === '/') return routePath;
  const base = prefix.replace(/\/+$/, '');
  if (routePath === '/' || routePath === '') return base || '/';
  return `${base}/${routePath.replace(/^\/+/, '')}`;
}

/** What resolving a name across files needs. */
interface Scope {
  projectRoot: string;
  parse: Parser;
}

/**
 * The value of a string known before the program runs: a literal, a template
 * or `+` over such strings, or a `const` holding one, declared in this file
 * or imported from another (`${BASE_URL}/orders`).
 */
function stringValue(
  node: Node | undefined,
  scope: Scope,
  depth = 0,
): string | undefined {
  if (!node || depth > 8) return undefined;
  if (
    node.isKind(SyntaxKind.StringLiteral) ||
    node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
  ) {
    return node.getLiteralValue();
  }
  if (
    node.isKind(SyntaxKind.ParenthesizedExpression) ||
    node.isKind(SyntaxKind.AsExpression) ||
    node.isKind(SyntaxKind.SatisfiesExpression)
  ) {
    return stringValue(node.getExpression(), scope, depth + 1);
  }
  if (node.isKind(SyntaxKind.TemplateExpression)) {
    let text = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) {
      const value = stringValue(span.getExpression(), scope, depth + 1);
      if (value === undefined) return undefined;
      text += value + span.getLiteral().getLiteralText();
    }
    return text;
  }
  if (
    node.isKind(SyntaxKind.BinaryExpression) &&
    node.getOperatorToken().isKind(SyntaxKind.PlusToken)
  ) {
    const left = stringValue(node.getLeft(), scope, depth + 1);
    const right = stringValue(node.getRight(), scope, depth + 1);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (node.isKind(SyntaxKind.Identifier)) {
    return stringValue(constantOf(node, scope), scope, depth + 1);
  }
  return undefined;
}

/** The initializer of the top-level `const` an identifier names, here or imported. */
function constantOf(identifier: Node, scope: Scope): Node | undefined {
  const source = identifier.getSourceFile();
  const [file, name] = bindingKey(
    scope.projectRoot,
    source,
    identifier.getText(),
  ).split('#');
  const holder = scope.parse(path.join(scope.projectRoot, file ?? ''));
  const declaration = name ? holder?.getVariableDeclaration(name) : undefined;
  return declaration?.getVariableStatement()?.getDeclarationKind() === 'const'
    ? declaration.getInitializer()
    : undefined;
}

/**
 * Walk a call chain back to the app it starts from, collecting `.basePath()`
 * prefixes on the way: `new Hono().basePath('/api').get(...)` starts at
 * `new Hono()` with prefix `/api`.
 *
 * Only router methods are walked through. Any other call returns a new app
 * (`factory.createApp()`), so the chain starts there: an identifier root
 * means every call on the way returned that same app.
 */
function chainOf(
  expression: Node,
  scope: Scope,
): { root: Node; prefix: string } {
  // Walked from the outside in, so each base path found goes in front.
  let prefix = '';
  let node = expression;
  for (;;) {
    if (node.isKind(SyntaxKind.ParenthesizedExpression)) {
      node = node.getExpression();
      continue;
    }
    if (node.isKind(SyntaxKind.CallExpression)) {
      const callee = node.getExpression();
      if (
        callee.isKind(SyntaxKind.PropertyAccessExpression) &&
        ROUTER_METHODS.has(callee.getName())
      ) {
        if (callee.getName() === 'basePath') {
          const base = stringValue(node.getArguments()[0], scope);
          if (base !== undefined) prefix = joinPath(base, prefix);
        }
        node = callee.getExpression();
        continue;
      }
    }
    return { root: node, prefix };
  }
}

/** The file a relative import names, as the project-relative path, or null. */
export function resolveImport(
  projectRoot: string,
  fromAbsolute: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith('.')) {
    for (const target of aliasTargets(projectRoot, specifier)) {
      const found = sourceFileAt(projectRoot, target);
      if (found) return found;
    }
    return null;
  }
  return sourceFileAt(
    projectRoot,
    path.resolve(path.dirname(fromAbsolute), specifier),
  );
}

/** The source file an import of `base` (no extension) lands on. */
function sourceFileAt(projectRoot: string, absolute: string): string | null {
  // TS ESM imports name the emitted `.js`; the source is `.ts`.
  const base = absolute.replace(/\.[cm]?js$/, '');
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ]) {
    if (fileExists(candidate)) return relativeFile(projectRoot, candidate);
  }
  return null;
}

const tsconfigPathsCache = new Map<
  string,
  { baseDir: string; paths: Record<string, string[]> }
>();

/**
 * Where a tsconfig `paths` alias (`@/server/app`) points, as absolute paths
 * to try in order. Reads the project's own tsconfig.json; `extends` is not
 * followed.
 */
function aliasTargets(projectRoot: string, specifier: string): string[] {
  let config = tsconfigPathsCache.get(projectRoot);
  if (!config) {
    const file = path.join(projectRoot, 'tsconfig.json');
    const options = fileExists(file)
      ? ts.readConfigFile(file, ts.sys.readFile).config?.compilerOptions
      : undefined;
    config = {
      baseDir: path.resolve(projectRoot, options?.baseUrl ?? '.'),
      paths: options?.paths ?? {},
    };
    tsconfigPathsCache.set(projectRoot, config);
  }
  const targets: string[] = [];
  for (const [pattern, replacements] of Object.entries(config.paths)) {
    const star = pattern.indexOf('*');
    const [head, tail] =
      star === -1
        ? [pattern, '']
        : [pattern.slice(0, star), pattern.slice(star + 1)];
    const matched =
      star === -1
        ? specifier === pattern
        : specifier.startsWith(head) && specifier.endsWith(tail);
    if (!matched) continue;
    const wildcard =
      star === -1
        ? ''
        : specifier.slice(head.length, specifier.length - tail.length);
    for (const replacement of replacements) {
      targets.push(
        path.resolve(config.baseDir, replacement.replace('*', wildcard)),
      );
    }
  }
  return targets;
}

/**
 * What one identifier in one file refers to, as `file#export`: an app, or a
 * route definition. Imports are followed one hop; re-export barrels are not.
 */
function bindingKey(
  projectRoot: string,
  source: SourceFile,
  name: string,
): string {
  const file = relativeFile(projectRoot, source.getFilePath());
  for (const declaration of source.getImportDeclarations()) {
    const target = resolveImport(
      projectRoot,
      source.getFilePath(),
      declaration.getModuleSpecifierValue(),
    );
    if (declaration.getDefaultImport()?.getText() === name) {
      return `${target ?? declaration.getModuleSpecifierValue()}#default`;
    }
    for (const named of declaration.getNamedImports()) {
      if ((named.getAliasNode()?.getText() ?? named.getName()) === name) {
        return `${target ?? declaration.getModuleSpecifierValue()}#${named.getName()}`;
      }
    }
  }
  return `${file}#${name}`;
}

/**
 * The app a chain root stands for. An identifier is its binding; an inline
 * `new Hono()` is named by what holds the whole chain: `const users = ...`,
 * `export default ...`, or failing both, its position.
 */
function appKey(projectRoot: string, source: SourceFile, root: Node): string {
  const file = relativeFile(projectRoot, source.getFilePath());
  if (root.isKind(SyntaxKind.Identifier)) {
    // A variable local to a function is that function's own: two factories
    // that both build `const r = new Hono()` are two apps.
    const declaration = root.getSymbol()?.getDeclarations()[0];
    if (
      declaration?.isKind(SyntaxKind.VariableDeclaration) &&
      !isTopLevel(declaration)
    ) {
      return localKey(file, declaration);
    }
    return bindingKey(projectRoot, source, root.getText());
  }
  let top: Node = root;
  for (;;) {
    const parent = top.getParent();
    if (
      (parent?.isKind(SyntaxKind.PropertyAccessExpression) ||
        parent?.isKind(SyntaxKind.CallExpression) ||
        parent?.isKind(SyntaxKind.ParenthesizedExpression)) &&
      parent.getExpression() === top
    ) {
      top = parent;
      continue;
    }
    if (parent?.isKind(SyntaxKind.VariableDeclaration)) {
      return isTopLevel(parent)
        ? `${file}#${parent.getName()}`
        : localKey(file, parent);
    }
    if (parent?.isKind(SyntaxKind.ExportAssignment)) return `${file}#default`;
    return `${file}@${top.getStart()}`;
  }
}

function isTopLevel(declaration: VariableDeclaration): boolean {
  return (
    declaration
      .getVariableStatement()
      ?.getParent()
      ?.isKind(SyntaxKind.SourceFile) === true
  );
}

function localKey(file: string, declaration: VariableDeclaration): string {
  return `${file}#${declaration.getName()}@${declaration.getStart()}`;
}

/**
 * The app a call to a function returns: `app.route('/users', userRoutes())`
 * mounts whatever `userRoutes` returns. Followed into an imported file too.
 * Null when the callee is not a function declared here or in a relative import.
 */
function returnedApp(call: Node, scope: Scope): string | null {
  if (!call.isKind(SyntaxKind.CallExpression)) return null;
  const callee = call.getExpression();
  if (!callee.isKind(SyntaxKind.Identifier)) return null;
  const [file, name] = bindingKey(
    scope.projectRoot,
    call.getSourceFile(),
    callee.getText(),
  ).split('#');
  const holder = scope.parse(path.join(scope.projectRoot, file ?? ''));
  if (!holder || !name) return null;
  const fn =
    (name === 'default'
      ? holder.getDefaultExportSymbol()?.getDeclarations()[0]
      : undefined) ??
    holder.getFunction(name) ??
    holder.getVariableDeclaration(name)?.getInitializer();
  if (
    !fn ||
    !(
      fn.isKind(SyntaxKind.FunctionDeclaration) ||
      fn.isKind(SyntaxKind.ArrowFunction) ||
      fn.isKind(SyntaxKind.FunctionExpression)
    )
  ) {
    return null;
  }
  const body = fn.getBody();
  // The factory's own return, not one inside a handler it defines.
  const returned = body?.isKind(SyntaxKind.Block)
    ? body
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .find(
          (statement) =>
            statement.getFirstAncestor(
              (node) =>
                node.isKind(SyntaxKind.FunctionDeclaration) ||
                node.isKind(SyntaxKind.ArrowFunction) ||
                node.isKind(SyntaxKind.FunctionExpression) ||
                node.isKind(SyntaxKind.MethodDeclaration),
            ) === fn,
        )
        ?.getExpression()
    : body;
  if (!returned) return null;
  return appKey(scope.projectRoot, holder, chainOf(returned, scope).root);
}

/**
 * Whether a `.use()` argument installs autotel's request span:
 * `autotelMiddleware()`, aliased on import, or a variable holding that call.
 */
function isAmbientMiddleware(arg: Node, scope: Scope): boolean {
  let node: Node | undefined = arg;
  if (node.isKind(SyntaxKind.Identifier)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    node = declaration?.isKind(SyntaxKind.VariableDeclaration)
      ? declaration.getInitializer()
      : undefined;
  }
  if (!node?.isKind(SyntaxKind.CallExpression)) return false;
  const callee = node.getExpression();
  if (!callee.isKind(SyntaxKind.Identifier)) return false;
  const name = bindingKey(
    scope.projectRoot,
    node.getSourceFile(),
    callee.getText(),
  ).split('#')[1];
  return name !== undefined && AMBIENT_APIS.includes(name);
}

/**
 * Method and path from an OpenAPI route definition: `createRoute({...})`, the
 * object itself, or a variable holding either, here or in an imported file.
 * The `{id}` placeholders become `:id`, as `@hono/zod-openapi` does at runtime.
 */
function openApiRoute(
  projectRoot: string,
  source: SourceFile,
  definition: Node,
  parse: Parser,
): { method: string; path: string } | null {
  let node: Node | undefined = definition;
  if (node.isKind(SyntaxKind.Identifier)) {
    const [file, name] = bindingKey(projectRoot, source, node.getText()).split(
      '#',
    );
    const holder = parse(path.join(projectRoot, file ?? ''));
    node = name
      ? holder?.getVariableDeclaration(name)?.getInitializer()
      : undefined;
  }
  if (node?.isKind(SyntaxKind.CallExpression)) node = node.getArguments()[0];
  if (!node?.isKind(SyntaxKind.ObjectLiteralExpression)) return null;

  const property = (key: string) => {
    const assignment = node.getProperty(key);
    return assignment?.isKind(SyntaxKind.PropertyAssignment)
      ? stringValue(assignment.getInitializer(), { projectRoot, parse })
      : undefined;
  };
  const method = property('method');
  const routePath = property('path');
  if (!method || routePath === undefined) return null;
  return {
    method: method.toUpperCase(),
    path: routePath.replaceAll(/\/\{(.+?)\}/g, '/:$1'),
  };
}

/**
 * One adapter for every framework that registers routes as `app.get(path, fn)`.
 *
 * Hono, Express, Fastify, and Elysia differ in everything except the shape this
 * scan cares about, so four adapters would be the same file copied four times.
 * Files are text-filtered before parsing: an app of any size has few route
 * files, and parsing all of `src/` to find them costs far more than reading it.
 *
 * Hono composes apps, so a registration's path is only the tail of the real
 * one. Mounts (`.route(prefix, app)`) are edges between apps, and every route
 * is reported once per path it is reachable at. A `.basePath()` clone shares
 * its app's routes and only prefixes those registered through it, so it is the
 * same app plus a prefix, never a mount.
 */
function routerAdapter(framework: Framework): FrameworkAdapter {
  return {
    framework,
    autoImports: [],
    extractRoutes: (context) => routerRoutes(framework, context),
    scopesFor: routerScopes,
  };
}

/**
 * Every route registered in the project, with its full path. Given `entry`,
 * an expression naming one app (`handle(app)` in a Next.js catch-all), only
 * the routes that app serves.
 */
function routerRoutes(
  framework: Framework,
  { projectRoot, parse }: AdapterContext,
  entry?: Node,
): RawRouteEntry[] {
  const scope: Scope = { projectRoot, parse };
  /* Resolved once every file is read: an app may be imported from a file
         that is scanned later. `named` is true when the chain starts at an
         identifier, whose own base path then applies. */
  type AppRef = { key: string; named: boolean; prefix: string };
  /* `bare`: a plain-verb path without a leading slash. Hono serves it (it
         prepends `/`), but so reads `cache.get('key', fallback)`, so it counts
         only on a receiver known to be an app. */
  const registrations: Array<{
    route: RawRouteEntry;
    app: AppRef;
    bare: boolean;
    at: Site;
  }> = [];
  /** Where a call sits, so registration order can be compared. */
  type Site = { file: string; pos: number };
  const mounts: Array<{
    parent: AppRef;
    child: string;
    prefix: string;
    at: Site;
  }> = [];
  const bases = new Map<string, { app: string; prefix: string }>();
  /* Apps with autotel middleware registered, and apps a factory built
     (`const app = createApp()`), keyed to the app the factory returns. The
     factory link carries middleware only: every `createApp()` result is its
     own app, so routes are not merged through it. */
  const ambient: Array<{ app: AppRef; path: string; at: Site }> = [];
  const builtBy = new Map<string, string>();
  const refOf = (source: SourceFile, expression: Node): AppRef => {
    const { root, prefix } = chainOf(expression, scope);
    return {
      key: appKey(projectRoot, source, root),
      named: root.isKind(SyntaxKind.Identifier),
      prefix,
    };
  };

  for (const absolute of [
    ...files(projectRoot, '{src,app,server,routes}/**/*.{ts,js,mts,mjs}'),
    ...files(projectRoot, '*.{ts,js,mts,mjs}'),
  ]) {
    const text = readFileSafe(absolute);
    if (!text || !ROUTER_CALL.test(text)) continue;

    const source = parse(absolute);
    if (!source) continue;
    const relative = relativeFile(projectRoot, absolute);

    /* What a name holds, when that is another app: `const routes =
           app.get(...)` and `export default app.get(...)` are `app`, and
           `const api = app.basePath('/api')` is `app` with routes through it
           under `/api`. A chain starting anywhere else is an app of its own,
           kept only if it sets a base path. */
    const holds = (key: string, value: Node | undefined): void => {
      if (!value) return;
      const { root, prefix } = chainOf(value, scope);
      const factoryApp = returnedApp(root, scope);
      if (factoryApp) builtBy.set(key, factoryApp);
      const named = root.isKind(SyntaxKind.Identifier);
      if (!named && !prefix) return;
      bases.set(key, {
        app: named ? appKey(projectRoot, source, root) : key,
        prefix,
      });
    };
    for (const declaration of source.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )) {
      holds(
        isTopLevel(declaration)
          ? `${relative}#${declaration.getName()}`
          : localKey(relative, declaration),
        declaration.getInitializer(),
      );
    }
    holds(
      `${relative}#default`,
      source.getExportAssignment((e) => !e.isExportEquals())?.getExpression(),
    );

    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) continue;
      const args = call.getArguments();
      const verb = callee.getName();
      const at = { file: relative, pos: call.getStart() };
      // Middleware, not a route: it gets no entry, only credit for the routes
      // it runs in front of.
      if (verb === 'use') {
        if (args.some((arg) => isAmbientMiddleware(arg, scope))) {
          ambient.push({
            app: refOf(source, callee.getExpression()),
            path: (args[0] && stringValue(args[0], scope)) ?? '*',
            at,
          });
        }
        continue;
      }
      if (args.length < 2) continue;

      const app = refOf(source, callee.getExpression());

      if (verb === 'route') {
        const mountPath = stringValue(args[0], scope);
        const sub = args[1];
        if (mountPath === undefined || !sub) continue;
        mounts.push({
          parent: app,
          child: returnedApp(sub, scope) ?? refOf(source, sub).key,
          prefix: mountPath,
          at,
        });
        continue;
      }

      if (!REGISTRATION.test(`.${verb}`)) continue;
      let method: string | null;
      let routePath: string;
      if (verb === 'openapi') {
        const definition = openApiRoute(projectRoot, source, args[0]!, parse);
        if (!definition) continue;
        ({ method, path: routePath } = definition);
      } else {
        const literal = stringValue(args[0], scope);
        if (literal === undefined) continue;
        routePath = literal;
        method = verb === 'all' ? null : verb.toUpperCase();
      }
      const bare =
        verb !== 'openapi' &&
        routePath !== '*' &&
        !routePath.startsWith('/') &&
        !isHonoApp(chainOf(callee.getExpression(), scope).root, scope);
      if (bare && framework !== 'hono') continue;

      registrations.push({
        route: {
          framework,
          kind: 'api',
          method,
          path: routePath,
          file: relative,
          handler: {
            line: call.getStartLineNumber(),
            column: source.getLineAndColumnAtPos(call.getStart()).column,
          },
        },
        app,
        bare,
        at,
      });
    }
  }

  /** An app key through any base-path aliases: the app, and their prefix. */
  const through = (
    key: string,
    seen = new Set<string>(),
  ): { app: string; prefix: string } => {
    const base = bases.get(key);
    if (!base || seen.has(key)) return { app: key, prefix: '' };
    if (base.app === key) return { app: key, prefix: base.prefix };
    const resolved = through(base.app, new Set(seen).add(key));
    return {
      app: resolved.app,
      prefix: joinPath(resolved.prefix, base.prefix),
    };
  };
  /** Where a reference registers: its app, and the prefix it adds. */
  const resolve = (ref: AppRef): { app: string; prefix: string } => {
    if (!ref.named) return { app: ref.key, prefix: ref.prefix };
    const resolved = through(ref.key);
    return {
      app: resolved.app,
      prefix: joinPath(resolved.prefix, ref.prefix),
    };
  };

  const edges = mounts.map((mount) => {
    const parent = resolve(mount.parent);
    return {
      parent: parent.app,
      child: through(mount.child).app,
      prefix: joinPath(parent.prefix, mount.prefix),
      at: mount.at,
    };
  });
  const middleware = ambient.map(({ app, path: mwPath, at }) => {
    const resolved = resolve(app);
    return {
      app: resolved.app,
      pattern: joinPath(resolved.prefix, mwPath),
      at,
    };
  });
  /**
   * Whether autotel middleware on `key` runs for a request to `routePath`
   * (relative to `key`) dispatched by the registration at `at`: its pattern
   * matches, and it was registered first, since Hono runs handlers in
   * registration order. `at` is null when order is settled already (an app
   * built by a factory has its middleware before anything is added to it).
   * Order is known within one file, and across files only when the app is
   * imported from the file that registers the middleware, which then runs
   * first. Anything else gets no credit: a false pass hides a dark route.
   */
  const coveredOn = (
    key: string,
    routePath: string,
    at: Site | null,
    seen = new Set<string>(),
  ): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    const home = key.split(/[#@]/)[0];
    const before = (mw: Site) =>
      at === null || (mw.file === at.file ? mw.pos < at.pos : mw.file === home);
    if (
      middleware.some(
        (mw) =>
          mw.app === key &&
          before(mw.at) &&
          patternMatches(mw.pattern, routePath),
      )
    ) {
      return true;
    }
    const factory = builtBy.get(key);
    return (
      factory !== undefined &&
      coveredOn(through(factory).app, routePath, null, seen)
    );
  };

  /**
   * Every path an app is mounted at, with the root app it hangs off, and
   * whether autotel middleware runs for `tail` on the way down that chain.
   */
  const mountsOf = (
    key: string,
    tail: string,
    at: Site,
    seen: Set<string>,
  ): Array<{ prefix: string; root: string; covered: boolean }> => {
    const covered = coveredOn(key, tail, at);
    // An app mounted in a cycle is treated as a root, so its routes stay.
    if (seen.has(key)) return [{ prefix: '', root: key, covered }];
    const parents = edges.filter((edge) => edge.child === key);
    if (parents.length === 0) return [{ prefix: '', root: key, covered }];
    const next = new Set(seen).add(key);
    return parents.flatMap((edge) =>
      mountsOf(edge.parent, joinPath(edge.prefix, tail), edge.at, next).map(
        (mount) => ({
          prefix: joinPath(mount.prefix, edge.prefix),
          root: mount.root,
          covered: covered || mount.covered,
        }),
      ),
    );
  };

  const served = entry
    ? resolve(refOf(entry.getSourceFile(), entry)).app
    : undefined;
  const apps = new Set([
    ...edges.flatMap((edge) => [edge.parent, edge.child]),
    ...registrations
      .filter((registration) => !registration.bare)
      .map((registration) => resolve(registration.app).app),
  ]);
  const routes: RawRouteEntry[] = [];
  for (const { route, app, bare, at } of registrations) {
    const { app: key, prefix } = resolve(app);
    if (bare && !apps.has(key)) continue;
    const tail = joinPath(prefix, route.path);
    // A path reached through two mounts is covered if either chain covers it.
    const paths = new Map<string, boolean>();
    for (const mount of mountsOf(key, tail, at, new Set())) {
      if (served === undefined || mount.root === served) {
        const full = joinPath(mount.prefix, tail);
        paths.set(full, (paths.get(full) ?? false) || mount.covered);
      }
    }
    for (const [routePath, covered] of paths) {
      // Hono serves `api/v1/x` at `/api/v1/x`.
      const full =
        routePath === '*' || routePath.startsWith('/')
          ? routePath
          : `/${routePath}`;
      routes.push({
        ...route,
        path: full,
        ...(covered ? { ambient: true } : {}),
      });
    }
  }
  return routes;
}

/* Scope to the registration call, not the whole router file. This includes
   wrappers around the handler (`trace(..., handler)`) while preventing one
   route's instrumentation from vouching for a sibling route. */
function routerScopes(
  route: RawRouteEntry,
  source: SourceFile,
): readonly Node[] | undefined {
  const line = route.handler?.line;
  if (line === undefined) return;
  const call = source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(
      (candidate) =>
        candidate.getStartLineNumber() === line &&
        REGISTRATION.test(candidate.getExpression().getText()),
    );
  if (!call) return;
  const handler = call.getArguments().at(-1);
  const declarations = handler
    ? handler
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .flatMap((identifier) => {
          const declaration = identifier
            .getDefinitions()[0]
            ?.getDeclarationNode();
          return declaration?.isKind(SyntaxKind.FunctionDeclaration) ||
            declaration?.isKind(SyntaxKind.VariableDeclaration)
            ? [declaration]
            : [];
        })
    : [];
  if (handler?.isKind(SyntaxKind.Identifier)) {
    const declaration = handler.getDefinitions()[0]?.getDeclarationNode();
    if (
      declaration?.isKind(SyntaxKind.FunctionDeclaration) ||
      declaration?.isKind(SyntaxKind.VariableDeclaration)
    ) {
      declarations.push(declaration);
    }
  }
  return [call, ...new Set(declarations)];
}

/* -------------------------------------------------------------------------- */
/* Registry and detection                                                      */
/* -------------------------------------------------------------------------- */

export function getAdapter(framework: Framework): FrameworkAdapter {
  switch (framework) {
    case 'next':
      return nextAdapter;
    case 'nitro':
      return nitroAdapter;
    case 'sveltekit':
      return svelteKitAdapter;
    case 'tanstack-start':
      return tanstackAdapter;
    case 'cloudflare':
      return cloudflareAdapter;
    case 'hono':
    case 'express':
    case 'fastify':
    case 'elysia':
      return routerAdapter(framework);
  }
}

export const SUPPORTED_FRAMEWORKS: readonly Framework[] = [
  'next',
  'nitro',
  'tanstack-start',
  'sveltekit',
  'hono',
  'express',
  'fastify',
  'elysia',
  'cloudflare',
];

export function isFramework(value: string): value is Framework {
  return (SUPPORTED_FRAMEWORKS as readonly string[]).includes(value);
}

/** What detectFramework() answers with. */
interface DetectFrameworkResult {
  framework: Framework | null;
  warnings: string[];
}

/**
 * Pick the framework to scan for.
 *
 * Meta-frameworks are checked first: a Nuxt app has `h3` installed and an
 * Express app does not become a Next app because it renders one page.
 */
export function detectFramework(
  projectRoot: string,
  deps: ReadonlySet<string>,
): DetectFrameworkResult {
  const warnings: string[] = [];

  const candidates: [Framework, boolean][] = [
    ['next', deps.has('next')],
    ['nitro', deps.has('nuxt') || deps.has('nitropack') || deps.has('h3')],
    [
      'tanstack-start',
      deps.has('@tanstack/react-start') || deps.has('@tanstack/start'),
    ],
    ['sveltekit', deps.has('@sveltejs/kit')],
    [
      'cloudflare',
      fileExists(path.join(projectRoot, 'wrangler.toml')) ||
        fileExists(path.join(projectRoot, 'wrangler.jsonc')) ||
        fileExists(path.join(projectRoot, 'wrangler.json')),
    ],
    ['hono', deps.has('hono')],
    ['elysia', deps.has('elysia')],
    ['fastify', deps.has('fastify')],
    ['express', deps.has('express')],
  ];

  const matched = candidates
    .filter(([, present]) => present)
    .map(([name]) => name);
  if (matched.length === 0) return { framework: null, warnings };
  if (matched.length > 1) {
    warnings.push(
      `Multiple frameworks detected (${matched.join(', ')}); scanning as ${matched[0]}. Use --framework to override.`,
    );
  }
  return { framework: matched[0] ?? null, warnings };
}
