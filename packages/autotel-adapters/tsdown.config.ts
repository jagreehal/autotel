import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    core: 'src/core.ts',
    hono: 'src/hono.ts',
    tanstack: 'src/tanstack.ts',
    next: 'src/next.ts',
    nitro: 'src/nitro.ts',
    cloudflare: 'src/cloudflare.ts',
    express: 'src/express.ts',
    fastify: 'src/fastify.ts',
    nestjs: 'src/nestjs.ts',
    sveltekit: 'src/sveltekit.ts',
    elysia: 'src/elysia.ts',
    'toolkit/index': 'src/toolkit/index.ts',
    'toolkit/storage': 'src/toolkit/storage.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  clean: true,
  treeshake: true,
  minify: false,
  target: false,
  external: ['autotel-edge'],
});
