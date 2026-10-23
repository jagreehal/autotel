import { relativeFile } from '../facts';
import type { RawRouteEntry, RouteKind } from '../types';
import {
  defaultExportLocation,
  files,
  segmentsToPath,
  type FrameworkAdapter,
} from './shared';

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

export const nitroAdapter: FrameworkAdapter = {
  framework: 'nitro',
  // Nitro auto-imports autotel's Nuxt-module helpers, so a handler can use them
  // without an import statement. A rule asking "is this autotel's logger?"
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
