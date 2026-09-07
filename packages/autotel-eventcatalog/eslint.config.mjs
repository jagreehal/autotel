import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    ignores: ['dist/**', '**/__fixtures__/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  eslintPluginUnicorn.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-nested-ternary': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Playwright's `Locator` mirrors DOM method names — `innerText()`,
    // `getAttribute()` — without being a DOM node, so the DOM-shape rules fire
    // on API calls they cannot see the type of. The `evaluate` callbacks in the
    // same file really do run in a browser, where `window` is the clearer name.
    files: ['src/*.browser.e2e.test.ts'],
    rules: {
      'unicorn/prefer-dom-node-dataset': 'off',
      'unicorn/prefer-dom-node-text-content': 'off',
      'unicorn/prefer-query-selector': 'off',
      'unicorn/prefer-global-this': 'off',
    },
  },
  {
    // `no-process-exit` exempts CLI apps, and this is the CLI entry point:
    // argument parsing reports the problem and exits with a status a shell can
    // branch on. Throwing instead would surface a stack trace to someone who
    // mistyped a flag.
    files: ['src/cli.ts'],
    rules: {
      'unicorn/no-process-exit': 'off',
    },
  },
);
