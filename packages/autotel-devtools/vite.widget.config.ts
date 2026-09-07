import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';

/**
 * Modules the embedded build swaps for a reduced `.lean.ts` sibling.
 *
 *  - `views/registry`: the reduced view set — traces, logs, errors, resources.
 *  - `webmcp`: no WebMCP tools off the embedded widget, so none of their
 *    definitions ship in its bundle.
 */
const LEAN_MODULES = ['src/widget/views/registry', 'src/widget/webmcp'];

/**
 * Swap each module above for its reduced sibling.
 *
 * A `resolve.alias` entry does not work here: the imports are written
 * extensionless (`../views/registry`, `./webmcp`), so an alias keyed on the
 * resolved `.ts` path never matches, and aliasing a relative specifier would
 * hit every module with that name. Resolving it explicitly is exact and
 * obvious. The basename test is only a cheap filter so the common import does
 * no resolution work; the resolved path is what decides.
 */
function leanModules(): Plugin {
  const swaps = LEAN_MODULES.map((name) => ({
    basename: name.slice(name.lastIndexOf('/') + 1),
    full: resolve(__dirname, `${name}.ts`),
    lean: resolve(__dirname, `${name}.lean.ts`),
  }));
  return {
    name: 'autotel-lean-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const candidates = swaps.filter((swap) => source.endsWith(swap.basename));
      if (candidates.length === 0) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return (
        candidates.find((swap) => swap.full === resolved?.id)?.lean ?? null
      );
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
 *    someone else's product page. It ships the reduced view set and no WebMCP
 *    tools, because every kilobyte here is one that page's users download.
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
    ...(fullpage ? [] : [leanModules()]),
    // emitCss:false keeps Svelte from emitting separate stylesheets — all
    // widget styling comes from the inlined styles.css injected into the shadow
    // root (component <style> blocks are forbidden, see MIGRATION.md).
    svelte({ emitCss: false }),
  ],
});
