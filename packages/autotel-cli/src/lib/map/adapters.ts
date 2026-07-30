import * as path from 'node:path';
import { globSync } from 'glob';
import {
  SyntaxKind,
  type CallExpression,
  type Node,
  type SourceFile,
} from 'ts-morph';
import { relativeFile, type Parser } from './facts';
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

  for (const declaration of source.getImportDeclarations()) {
    if (!declaration.getModuleSpecifierValue().startsWith(modulePrefix))
      continue;
    for (const named of declaration.getNamedImports()) {
      if (!names.has(named.getName())) continue;
      locals.set(
        named.getAliasNode()?.getText() ?? named.getName(),
        named.getName(),
      );
    }
    const namespace = declaration.getNamespaceImport()?.getText();
    if (namespace) namespaces.add(namespace);
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

/** Nitro encodes the method in the filename: `users.post.ts` is `POST /users`. */
function nitroMethodSuffix(fileName: string): {
  method: string | null;
  base: string;
} {
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

const ROUTER_CALL = /\.\s*(get|post|put|patch|delete|all|use)\s*\(\s*['"`]/;

/**
 * One adapter for every framework that registers routes as `app.get(path, fn)`.
 *
 * Hono, Express, Fastify, and Elysia differ in everything except the shape this
 * scan cares about, so four adapters would be the same file copied four times.
 * Files are text-filtered before parsing: an app of any size has few route
 * files, and parsing all of `src/` to find them costs far more than reading it.
 */
function routerAdapter(framework: Framework): FrameworkAdapter {
  return {
    framework,
    autoImports: [],
    extractRoutes({ projectRoot, parse }) {
      const routes: RawRouteEntry[] = [];

      for (const absolute of [
        ...files(projectRoot, '{src,app,server,routes}/**/*.{ts,js,mts,mjs}'),
        ...files(projectRoot, '*.{ts,js,mts,mjs}'),
      ]) {
        const text = readFileSafe(absolute);
        if (!text || !ROUTER_CALL.test(text)) continue;

        const source = parse(absolute);
        if (!source) continue;
        const relative = relativeFile(projectRoot, absolute);

        for (const call of source.getDescendantsOfKind(
          SyntaxKind.CallExpression,
        )) {
          const callee = call.getExpression();
          const match = /\.(get|post|put|patch|delete|all|use)$/.exec(
            callee.getText(),
          );
          if (!match?.[1]) continue;

          const args = call.getArguments();
          const first = args[0];
          if (!first || args.length < 2) continue;
          const literal = /^['"`](.*)['"`]$/s.exec(first.getText());
          if (!literal?.[1]) continue;
          const routePath = literal[1];
          if (routePath !== '*' && !routePath.startsWith('/')) continue;

          const verb = match[1];
          routes.push({
            framework,
            kind: verb === 'use' ? 'middleware' : 'api',
            method:
              verb === 'use' || verb === 'all' ? null : verb.toUpperCase(),
            path: routePath,
            file: relative,
            handler: {
              line: call.getStartLineNumber(),
              column: source.getLineAndColumnAtPos(call.getStart()).column,
            },
          });
        }
      }

      return routes;
    },

    /* Scope to the registration call, not the whole router file. This includes
       wrappers around the handler (`trace(..., handler)`) while preventing one
       route's instrumentation from vouching for a sibling route. */
    scopesFor(route, source) {
      const line = route.handler?.line;
      if (line === undefined) return;
      const call = source
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find(
          (candidate) =>
            candidate.getStartLineNumber() === line &&
            /\.(get|post|put|patch|delete|all|use)$/.test(
              candidate.getExpression().getText(),
            ),
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
    },
  };
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

/**
 * Pick the framework to scan for.
 *
 * Meta-frameworks are checked first: a Nuxt app has `h3` installed and an
 * Express app does not become a Next app because it renders one page.
 */
export function detectFramework(
  projectRoot: string,
  deps: ReadonlySet<string>,
): { framework: Framework | null; warnings: string[] } {
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
