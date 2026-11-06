import { defineConfig } from 'tsdown';

export default defineConfig({
  // package.json `main` is dist/extension.js (matching the published VSIX layout),
  // so emit `.js` here rather than the shared cjs -> `.cjs` naming.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  entry: { extension: 'src/extension.ts' },
  outDir: 'dist',
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  sourcemap: false,
  clean: true,
  dts: false,
  // CRITICAL: bundle autotel-devtools (and subexports) into dist.
  // The .vsix has no node_modules; runtime resolution will fail otherwise.
  // Resolve ESM builds even though the output is CJS: a package's `require`
  // build can't be tree-shaken, and semantic-conventions' CJS build alone adds
  // about 250 KiB of unused constants.
  inputOptions: (options) => ({
    ...options,
    resolve: {
      ...options.resolve,
      conditionNames: ['node', 'import', 'module', 'default'],
    },
  }),
  deps: {
    neverBundle: ['vscode'],
    alwaysBundle: [/^autotel-devtools($|\/)/],
  },
});
