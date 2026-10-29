import { createRequire } from 'node:module';

// Synchronous require that works in both the ESM and CJS builds. See
// packages/autotel/src/node-require.ts for the __filename / import.meta.url
// fallback. Built on first use so importing a module stays side-effect-free.
declare const __filename: string | undefined;
export function ownRequire(): NodeJS.Require {
  return createRequire(
    /* oxlint-disable-next-line anti-slop/no-runtime-typeof -- Probing which module format this build is running as. `__filename` is bound only in the CJS output; the presence of the binding is the fact being read. */
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
}

export function loadModule(id: string): any {
  return ownRequire()(id);
}
