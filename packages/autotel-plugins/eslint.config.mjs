import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import eslintPluginAwaitly from 'eslint-plugin-awaitly';
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
    plugins: {
      awaitly: eslintPluginAwaitly,
    },
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-nested-ternary': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      // Awaitly plugin rules
      'awaitly/no-immediate-execution': 'error',
      'awaitly/require-thunk-for-key': 'error',
      'awaitly/stable-cache-keys': 'error',
      'awaitly/no-floating-workflow': 'error',
      'awaitly/no-floating-result': 'error',
      'awaitly/require-result-handling': 'error',
      'awaitly/no-options-on-executor': 'error',
      'awaitly/no-double-wrap-result': 'error',
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
