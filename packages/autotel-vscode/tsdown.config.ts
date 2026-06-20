import { defineConfig } from 'tsdown'

export default defineConfig({
  // package.json `main` is dist/extension.js (matching the published VSIX layout),
  // so emit `.js` here rather than the shared cjs -> `.cjs` naming.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  entry: { extension: 'src/extension.ts' },
  outDir: 'dist',
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: false,
  // CRITICAL: bundle autotel-devtools (and subexports) into dist.
  // The .vsix has no node_modules; runtime resolution will fail otherwise.
  esbuildOptions(options) {
    options.conditions = ['require', 'node', 'default']
  },
  deps: {
    neverBundle: ['vscode'],
    alwaysBundle: [/^autotel-devtools($|\/)/],
  },
})
