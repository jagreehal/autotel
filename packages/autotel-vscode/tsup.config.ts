import { defineConfig } from 'tsup'

export default defineConfig({
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
  noExternal: [/^autotel-devtools($|\/)/],
  external: ['vscode'],
  esbuildOptions(options) {
    options.conditions = ['require', 'node', 'default']
  },
})
