/**
 * tsup-compatible output filenames so the migration to tsdown does not change
 * any package's published file layout (and therefore needs no `package.json`
 * `exports`/`main`/`types` edits):
 *
 *   ESM → `.js`  + `.d.ts`   (tsdown default would be `.mjs` + `.d.mts`)
 *   CJS → `.cjs` + `.d.cts`
 *
 * Pass as `outExtensions` in each package's `defineConfig({ ... })`.
 *
 * @type {import('tsdown').Options['outExtensions']}
 */
export const tsupCompatOutExtensions = ({ format }) =>
  format === 'es'
    ? { js: '.js', dts: '.d.ts' }
    : { js: '.cjs', dts: '.d.cts' };
