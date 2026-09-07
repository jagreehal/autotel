/**
 * The WebMCP tool surface, absent (embedded widget).
 *
 * The tools are full-page only: the embedded widget is a guest in someone
 * else's page, where `document.modelContext` belongs to that page. The `mode`
 * gate in `Widget.svelte` is what makes that true at runtime; this file is what
 * stops the embedded bundle carrying tool definitions that gate guarantees will
 * never run, on the tighter of the two budgets.
 *
 * Typed as the real module's export, so a change to that signature fails here
 * rather than at the swap. `import type` erases, so nothing reaches the bundle.
 */

import type { devtoolsTools as DevtoolsTools } from './webmcp';

export const devtoolsTools: typeof DevtoolsTools = () => ({
  mount: async () => {},
  unmount: () => {},
});
