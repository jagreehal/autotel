import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    drizzle: 'src/drizzle/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  target: false,
  // The source comments explain the driver internals this package reaches into,
  // which readers of the source want and installers of the package pay for.
  // They are 20% of the emitted JavaScript, so they stay out of the bundle and
  // the published .d.ts keeps the ones an editor shows you.
  outputOptions: { comments: false },
});
