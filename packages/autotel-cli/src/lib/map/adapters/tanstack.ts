import { relativeFile } from '../facts';
import { readFileSafe } from '../../fs';
import type { RawRouteEntry } from '../types';
import {
  files,
  importedCalls,
  locationOf,
  segmentsToPath,
  type FrameworkAdapter,
} from './shared';

export const tanstackAdapter: FrameworkAdapter = {
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
