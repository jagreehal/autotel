import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    ignores: ['dist/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  eslintPluginUnicorn.configs.recommended,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Browser-safety guardrail ─────────────────────────────────────────
      // autotel-agents is consumed by the devtools widget (browser) AND run by
      // the devtools server (node). It must stay pure: no `node:*`, no
      // protobufjs, no `ws`, no fs. See the "pipeline boundary" decision: the
      // server decodes OTLP and hands this package plain objects.
      //
      // TODO: swap this hand-rolled list for eslint-plugin-no-server-imports
      // (`mode: 'all-non-server'`) once it clears the monorepo's minimumReleaseAge
      // guard (it was <3 days old at scaffold time) — that plugin knows 100+
      // server-only modules out of the box.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'autotel-agents must stay browser-safe — no node:* imports.',
            },
          ],
          paths: [
            'fs',
            'path',
            'crypto',
            'os',
            'child_process',
            'http',
            'https',
            'net',
            'ws',
            'protobufjs',
          ].map((name) => ({
            name,
            message: 'autotel-agents must stay browser-safe — server-only module.',
          })),
        },
      ],

      'unicorn/prevent-abbreviations': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/prefer-string-slice': 'off',
      'unicorn/prefer-at': 'off',
      'unicorn/explicit-length-check': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-exports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Enums are not allowed. Use union types or const assertions instead.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'unicorn/filename-case': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
