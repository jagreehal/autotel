// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
  ignores: ['dist/**', 'eslint.config.mjs'],
}, {
  files: ['src/**/*.ts', 'src/**/*.tsx'],
  ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
}, {
  files: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  languageOptions: {
    parserOptions: { project: false },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
}, // Widget UI files: JSX factory (h) appears unused but is required by Preact JSX transform;
// icon imports may be conditionally used; `any` is needed for dynamic OTLP data in UI
{
  files: ['src/widget/**/*.tsx', 'src/widget/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
  },
}, // Server OTLP parsing uses `any` for unknown JSON payloads by design
{
  files: ['src/server/otlp.ts', 'src/server/types.ts', 'src/server/remote-exporter.ts', 'src/server/exporter.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
}, storybook.configs["flat/recommended"]);
