import { createRequire } from 'node:module';

// See packages/autotel/src/node-require.ts for the rationale of the
// __filename / import.meta.url fallback.
declare const __filename: string | undefined;
const require = createRequire(
  /* oxlint-disable-next-line anti-slop/no-runtime-typeof -- Probing which module format this build is running as. `__filename` is bound only in the CJS output; there is no domain value to parse, the presence of the binding is the fact being read. */
  typeof __filename === 'string' ? __filename : import.meta.url,
);
// SAFETY: this package's own manifest, resolved relative to this file. npm
// guarantees a `version` on anything it publishes.
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
