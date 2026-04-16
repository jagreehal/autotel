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
      'unicorn/no-empty-file': 'off',
      'unicorn/require-module-specifiers': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/prefer-spread': 'off',
      'unicorn/no-useless-fallback-in-spread': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/no-useless-switch-case': 'off',
      'unicorn/prefer-native-coercion-functions': 'off',
      'unicorn/switch-case-braces': 'off',
      'unicorn/no-lonely-if': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/prefer-math-min-max': 'off',
      'unicorn/no-negation-in-equality-check': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      'prefer-rest-params': 'off',
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
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
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
);
