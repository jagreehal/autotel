import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    globalSetup: './globalSetup.ts',
    reporters: ['default', 'autotel-vitest/reporter'],
  },
});
