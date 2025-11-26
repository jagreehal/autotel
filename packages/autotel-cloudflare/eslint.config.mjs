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
      'unicorn/no-this-assignment': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/prefer-export-from': 'off',
      'unicorn/prefer-type-error': 'off',
      'unicorn/explicit-length-check': 'off',
      'unicorn/prefer-at': 'off',
      'unicorn/prefer-string-slice': 'off',
      'unicorn/prefer-switch': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/prefer-default-parameters': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/prefer-optional-catch-binding': 'off',
      'unicorn/catch-error-name': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
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
    // Allow barrel export in index.ts and entry point files
    files: [
      'src/index.ts',
      'src/sampling.ts',
      'src/events.ts',
      'src/logger.ts',
      'src/testing.ts',
      'src/bindings.ts',
      'src/handlers.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
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
      'unicorn/no-useless-undefined': 'off',
      'unicorn/prefer-optional-catch-binding': 'off',
      'unicorn/catch-error-name': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
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
