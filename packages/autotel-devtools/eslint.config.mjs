// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteConfig from './svelte.config.js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    ignores: ['dist/**', 'storybook-static/**', 'eslint.config.mjs'],
  },
  {
    // Plain TS/TSX. Rune modules (*.svelte.ts) are handled by the svelte block
    // below, so exclude them from the plain-TS parser.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Svelte components (*.svelte) and rune modules (*.svelte.ts) — parsed by
    // svelte-eslint-parser with the TS parser for <script lang="ts">. This is
    // what enables the Svelte a11y rules.
    files: ['src/**/*.svelte', 'src/**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
    rules: {
      // Dynamic OTLP telemetry data is shaped at runtime — `any` is intentional
      // in the UI layer.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // TS (lang="ts") already checks for undefined identifiers; the base
      // no-undef rule otherwise flags every DOM global (window, document, File,
      // ResizeObserver, …). This is the standard typescript-eslint guidance.
      'no-undef': 'off',
      // Reactive state lives in the signal shim (signals.svelte.ts), which
      // reacts on reassignment — the same idiom the Preact-signals original
      // used. The plain Map/Set instances here are non-reactive computation
      // (built fresh, then assigned to a signal), so SvelteMap/SvelteSet would
      // add overhead without benefit.
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    languageOptions: {
      parserOptions: { project: false },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Widget logic modules: `any` is needed for dynamic OTLP data in the UI.
    files: ['src/widget/**/*.ts'],
    ignores: ['src/widget/**/*.svelte.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Server OTLP parsing uses `any` for unknown JSON payloads by design.
    files: ['src/server/otlp.ts', 'src/server/types.ts', 'src/server/remote-exporter.ts', 'src/server/exporter.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  storybook.configs["flat/recommended"],
);
