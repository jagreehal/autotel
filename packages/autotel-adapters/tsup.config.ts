import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    core: 'src/core.ts',
    hono: 'src/hono.ts',
    tanstack: 'src/tanstack.ts',
    next: 'src/next.ts',
    nitro: 'src/nitro.ts',
    cloudflare: 'src/cloudflare.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  clean: true,
  treeshake: true,
  minify: false,
});
