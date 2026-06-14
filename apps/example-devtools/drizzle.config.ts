import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/shared/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: 'file:./drizzle/dev.db',
  },
});
