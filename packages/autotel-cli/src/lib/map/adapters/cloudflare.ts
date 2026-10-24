import * as path from 'node:path';
import { fileExists } from '../../fs';
import { defaultExportLocation, type FrameworkAdapter } from './shared';

export const cloudflareAdapter: FrameworkAdapter = {
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
