import * as path from 'node:path';
import { relativeFile } from '../facts';
import { fileExists } from '../../fs';
import type { RawRouteEntry } from '../types';
import { routerRoutes, routerScopes } from './router';
import {
  defaultExportLocation,
  files,
  importedCalls,
  methodExports,
  segmentsToPath,
  type FrameworkAdapter,
} from './shared';

function nextAppDir(root: string): string | null {
  for (const candidate of ['app', 'src/app']) {
    if (files(root, `${candidate}/**/route.{ts,tsx,js,jsx}`).length > 0) {
      return candidate;
    }
  }
  return null;
}

export const nextAdapter: FrameworkAdapter = {
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
