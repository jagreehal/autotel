import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';

/**
 * Swap the view registry for the reduced one.
 *
 * A `resolve.alias` entry does not work here: the import is written
 * extensionless (`../views/registry`), so an alias keyed on the resolved `.ts`
 * path never matches, and aliasing a relative specifier would hit every module
 * with that name. Resolving it explicitly is exact and obvious.
 */
function leanRegistry(): Plugin {
  const full = resolve(__dirname, 'src/widget/views/registry.ts');
  const lean = resolve(__dirname, 'src/widget/views/registry.lean.ts');
  return {
    name: 'autotel-lean-registry',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.includes('views/registry')) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved?.id === full ? lean : null;
    },
  };
}

/**
 * Builds the browser bundle — IIFE, CSS inlined.
 *
 * Two bundles come out of this one config so they cannot drift in their Svelte,
 * PostCSS or target settings:
 *
 *  - `widget.global.js` (default) is the **embedded** widget, a guest in
 *    someone else's product page. It ships the reduced view set, because every
 *    kilobyte here is one that page's users download.
 *  - `fullpage.global.js` (`FULLPAGE=1`) is the viewer application, with every
 *    view and no size budget.
 */
const fullpage = process.env.FULLPAGE === '1';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/widget/auto.ts'),
      name: 'AutotelDevtools',
      formats: ['iife'],
      fileName: () => (fullpage ? 'fullpage.global.js' : 'widget.global.js'),
    },
    outDir: 'dist',
    emptyOutDir: false, // don't wipe server build
    target: 'es2020',
    minify: true,
    cssCodeSplit: false, // inline all CSS into the JS bundle
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  plugins: [
    ...(fullpage ? [] : [leanRegistry()]),
    // emitCss:false keeps Svelte from emitting separate stylesheets — all
    // widget styling comes from the inlined styles.css injected into the shadow
    // root (component <style> blocks are forbidden, see MIGRATION.md).
    svelte({ emitCss: false }),
  ],
});
