import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = `http://localhost:${process.env.API_PORT ?? 8082}`;

// The SPA and the API share an origin, as they do behind a reverse proxy in
// production. Object form, not the string shorthand: the shorthand turns on
// changeOrigin, which rewrites Host to the API's, and the relay then sees a
// different origin from the page's. xfwd passes the public host along too.
const toApi = { target, xfwd: true };

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': toApi,
      '/otel': toApi,
      '/rum-intake': toApi,
    },
  },
});
