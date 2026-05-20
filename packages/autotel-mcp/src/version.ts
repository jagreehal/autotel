import { createRequire } from 'node:module';

// See packages/autotel/src/node-require.ts for the rationale of the
// __filename / import.meta.url fallback.
declare const __filename: string | undefined;
const require = createRequire(
  typeof __filename === 'string' ? __filename : import.meta.url,
);
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
