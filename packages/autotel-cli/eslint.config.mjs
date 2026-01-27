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
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/number-literal-case': 'off',
      'unicorn/no-process-exit': 'off', // CLI needs process.exit
      'unicorn/prefer-module': 'off', // We use dynamic imports
      'unicorn/import-style': 'off', // Allow named imports from node:path
      'unicorn/prefer-switch': 'off', // if-else chains are fine
      'unicorn/prefer-ternary': 'off', // explicit if statements are clearer
      'unicorn/switch-case-braces': 'off', // single-line cases don't need braces
      'unicorn/no-array-callback-reference': 'off', // passing functions to map is fine
      'unicorn/prefer-single-call': 'off', // multiple push calls are fine for clarity
      'unicorn/no-for-loop': 'off', // for loops are sometimes clearer
      'unicorn/no-useless-switch-case': 'off', // default case fallthrough is fine
      'unicorn/prefer-export-from': 'off', // conflicts with no barrel exports
      'unicorn/no-negated-condition': 'off', // negated conditions are fine
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
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
  {
    files: ['src/**/*.test.ts'],
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
      'unicorn/import-style': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
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
