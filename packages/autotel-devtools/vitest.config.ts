/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

// Two projects so the Svelte `browser` resolve condition (needed by
// @testing-library/svelte's render/mount) does NOT leak into the Node server
// tests — under `browser`, packages like `ws` resolve to a browser stub and
// `new WebSocketServer()` breaks (and `protobufjs`'s default-import shape
// changes, breaking the OTLP/protobuf decoder).
//
// IMPORTANT: separate *projects* are not enough — running both in one vitest
// invocation shares a worker pool and the browser condition intermittently
// bleeds into the server worker (flaky OTLP/protobuf decode failures). The
// `test` script therefore runs `--project server` and `--project widget` as
// SEPARATE invocations so each process only applies one resolve config. Keep
// them split; do not collapse back into a single `vitest run`.
export default defineConfig({
  test: {
    projects: [
      {
        // Server library — pure Node, no Svelte, no browser condition.
        // `src/query` and `src/wire` live here too: both are plain TypeScript
        // shared by the server (compiles an AST to SQL, encodes the payload)
        // and the widget (highlights and lints the same tokens, decodes the
        // same payload), with no DOM and no Svelte, so they belong in the
        // project that doesn't apply the browser resolve condition.
        test: {
          name: 'server',
          include: [
            'src/server/**/*.test.ts',
            'src/query/**/*.test.ts',
            'src/wire/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        // Widget — Svelte components + signal-shim logic. svelte compiles
        // .svelte/.svelte.ts; svelteTesting adds the browser resolve condition.
        plugins: [svelte({ emitCss: false }), svelteTesting()],
        test: {
          name: 'widget',
          include: ['src/widget/**/*.test.ts', 'src/widget/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
