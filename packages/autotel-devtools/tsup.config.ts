import { defineConfig } from 'tsup'

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'server/index': 'src/server/index.ts',
    'server/exporter': 'src/server/exporter.ts',
    'server/log-exporter': 'src/server/log-exporter.ts',
    'server/remote-exporter': 'src/server/remote-exporter.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: [
    'ws',
    '@opentelemetry/api',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/core',
    'autotel',
  ],
})
