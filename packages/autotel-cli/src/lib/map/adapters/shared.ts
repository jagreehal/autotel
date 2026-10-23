import { globSync } from 'glob';
import {
  SyntaxKind,
  type CallExpression,
  type Node,
  type SourceFile,
} from 'ts-morph';
import { moduleBindings, type Parser } from '../facts';
import type { Framework, RawRouteEntry, SourceLocation } from '../types';

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

export function files(root: string, pattern: string): string[] {
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
export function segmentsToPath(segments: readonly string[]): string {
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

export function locationOf(
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
export function methodExports(
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
export function defaultExportLocation(
  source: SourceFile,
): SourceLocation | null {
  const declarations = source.getExportedDeclarations().get('default');
  return locationOf(declarations?.[0], source);
}

/**
 * Calls to named APIs from one package family, resolved through aliases and
 * namespace imports. Text mentions and same-named local helpers do not count.
 */
export function importedCalls(
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
