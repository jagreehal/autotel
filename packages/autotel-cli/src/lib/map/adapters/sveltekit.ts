import * as path from 'node:path';
import { relativeFile } from '../facts';
import { fileExists } from '../../fs';
import type { RawRouteEntry } from '../types';
import {
  files,
  locationOf,
  methodExports,
  segmentsToPath,
  type FrameworkAdapter,
} from './shared';

export const svelteKitAdapter: FrameworkAdapter = {
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
