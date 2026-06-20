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
    ignores: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/number-literal-case': 'off', // Conflicts with Prettier (Prettier uses lowercase)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            'Dynamic imports (await import(...)) are not allowed. Use static imports at the top of the file.',
        },
        {
          selector: 'ExportAllDeclaration',
          message:
            'Barrel exports (export * from) are not allowed. Use explicit named exports instead.',
        },
        {
          selector: 'TSEnumDeclaration',
          message:
            'Enums are not allowed. Use union types or const assertions instead.',
        },
        {
          // Named *value* imports of Node builtins break browser bundlers:
          // Vite rewrites `node:*` to a stub that exports nothing, and Rollup
          // hard-errors on the unresolved named binding, failing the consumer's
          // build. Use a namespace import (`import * as nodeFs from 'node:fs'`)
          // for values, or `import type` for type-only usage (which is erased).
          selector:
            'ImportDeclaration[importKind!="type"][source.value=/^node:/] ImportSpecifier[importKind!="type"]',
          message:
            "Don't use a named import for a Node builtin — it breaks browser bundlers. Use `import * as ns from 'node:...'` for values, or `import type` for types. See node-require.ts.",
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-nested-ternary': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            'Dynamic imports (await import(...)) are not allowed. Use static imports at the top of the file.',
        },
        {
          selector: 'ExportAllDeclaration',
          message:
            'Barrel exports (export * from) are not allowed. Use explicit named exports instead.',
        },
        {
          selector: 'TSEnumDeclaration',
          message:
            'Enums are not allowed. Use union types or const assertions instead.',
        },
      ],
    },
  },
);
