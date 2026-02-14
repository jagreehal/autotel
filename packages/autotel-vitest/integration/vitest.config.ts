import { defineConfig } from 'vitest/config';
import { OtelReporter } from '../src/reporter';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['integration/**/*.compat.spec.ts'],
    globalSetup: './integration/globalSetup.ts',
    reporters: ['default', new OtelReporter()],
  },
});
