---
"autotel-devtools": minor
---

Rewrite the devtools widget UI from Preact to Svelte 5.

- All widget components migrated to Svelte 5 (runes). Reactive state flows through a small signal shim (`signals.svelte.ts`) that preserves the `.value` API on top of runes, consumed by `store.svelte.ts` — so the store and call sites stayed stable across the rewrite.
- The widget still mounts into a Shadow DOM custom element (`<autotel-devtools>`); the **public surface is unchanged** — server exports, the custom element, the CLI, and `widget.js` all behave as before.
- **Accessibility**: a cohesive brand-accent `:focus-visible` ring replaces the browser default (which was off-brand and got clipped at scroll-container edges); list rows use an inset ring so it's never cut off; inputs that previously showed no visible focus now do. Clickable rows/SVG nodes gain keyboard activation, and modal backdrops are real `<button>`s.
- **Visual fixes**: service-map edge labels get a surface-coloured halo so they stay legible over their connection lines; waterfall event markers now align to the bar instead of hanging below it.
- Unified the tab → view dispatch into a single `TabView` shared by the full-page and embedded-panel surfaces (previously duplicated and drifted).
- Icons moved from `lucide-svelte` to the Svelte 5-native `@lucide/svelte`.
- **Tooling**: Vite, Storybook, Vitest, ESLint, and Prettier all moved to Svelte. `.svelte` files are now linted (`eslint-plugin-svelte`, incl. a11y rules) and formatted (`prettier-plugin-svelte`). The Storybook browser story-tests are temporarily out of CI pending an upstream `@storybook/svelte-vite` + `vite-plugin-svelte` + rolldown incompatibility; `build-storybook` still compiles and validates every story.
