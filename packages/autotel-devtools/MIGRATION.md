# Preact → Svelte 5 Migration Spec

> Single source of truth for porting `src/widget/**` from Preact to Svelte 5.
> Every component port MUST follow the patterns here so the result is consistent.
> Branch: `feat/devtools-svelte`.

## Scope

- **Rewrite**: everything under `src/widget/**` that renders UI (39 `.tsx`), plus `store.ts`, the mount layer (`element.ts`, `auto.ts`, `Widget.tsx`), Storybook stories, and component tests.
- **Untouched**: `src/server/**` (pure Node), and the framework-agnostic logic modules:
  `src/widget/genai/*.ts` (detect/normalize/stitch/prices/types — published via `genai/index`),
  `src/widget/utils/*.ts`, `src/widget/store`'s pure helpers, websocket/export-import logic.
  These are plain TS and stay as-is (only import paths change if a file is renamed).

## Foundation decisions (locked)

### 1. Mounting: `mount()`, NOT compile-to-custom-element
Keep `element.ts` / `auto.ts` exactly as they are — manual shadow root + `<style>` with
inlined CSS. Only swap the framework call:
- Preact `render(h(Widget, props), container)` → Svelte `mount(Widget, { target: container, props })`
- cleanup `render(null, container)` → `unmount(instance)`

Rationale: Svelte's `customElement` compile mode has sharp edges with context, slots, and
lifecycle inside shadow DOM. The manual mount keeps our proven CSS-injection layer intact.

### 2. CSS: Tailwind utilities only — NO component `<style>` blocks
Svelte scoped `<style>` injects into `document.head`, which **cannot reach our shadow root**.
So:
- Components use Tailwind utility classes exactly as today (via `class={cn(...)}`).
- The single `styles.css?inline` stays the source of all styles, injected into the shadow root.
- **Never** add a `<style>` block to a widget `.svelte` component.
- One-off dynamic values stay as inline `style={...}` (works in shadow DOM).

### 3. State: runes-backed signal shim preserves the `.value` API
`signals.svelte.ts` implements `signal` / `computed` / `effect` / `batch` over Svelte 5 runes,
exposing the same `.value` get/set + `.peek()` surface as `@preact/signals`. This means:
- `store.ts` → `store.svelte.ts` is essentially a one-line import swap.
- Every component KEEPS its `xxxSignal.value` reads/writes — minimal churn, minimal risk.
- Reading `signal.value` in a `.svelte` template/`$derived` is reactive (getter touches `$state`).

Do NOT rewrite the store into ad-hoc `$state` objects — the shim is the chosen idiom.

### 4. Icons: `lucide-preact` → `lucide-svelte`
`import { Copy, Check } from 'lucide-preact'` → `from 'lucide-svelte'`.
Usage `<Copy size={14} className="..." />` → `<Copy size={14} class="..." />` (note `class`, not `className`).

### 5. No component library (for now)
Stay with plain components + Tailwind + lucide. **shadcn-svelte / bits-ui is deferred** — its
floating/portal primitives render to `document.body`, escaping the shadow root and losing all
styles. Revisit only with a shadow-root-aware portal target.

## Per-component translation rules

| Preact | Svelte 5 |
|---|---|
| `function Foo(props) { return <jsx/> }` in `.tsx` | `Foo.svelte` with `<script lang="ts">` + markup |
| `const [x, setX] = useState(v)` | `let x = $state(v)` |
| `useMemo(() => f(), [deps])` | `const x = $derived.by(() => f())` (or `$derived(expr)`) |
| `useEffect(() => {...; return cleanup}, [deps])` | `$effect(() => {...; return cleanup})` |
| `useRef(null)` (DOM) | `let el: HTMLX | undefined = $state()` + `bind:this={el}` |
| `useRef(v)` (mutable, non-DOM) | plain `let r = { current: v }` (no rune) |
| `useCallback(fn, [])` | plain `function fn() {}` |
| `props.children` | `let { children } = $props()` + `{@render children?.()}` |
| `className={cn(...)}` | `class={cn(...)}` |
| `onClick={fn}` | `onclick={fn}` |
| `style={{ width: '48px' }}` | `style="width: 48px;"` or `style={`...`}` for dynamic |
| signal read `sig.value` | unchanged — `sig.value` |
| conditional `if (x) return null` | `{#if !x}...{/if}` wrapping markup (no early return in markup) |
| list `.map(item => <X/>)` | `{#each items as item (key)}<X/>{/each}` |
| `lucide-preact` | `lucide-svelte`, `className`→`class` |
| event dispatch / callback props | callback props: `let { onfoo } = $props()` then `onfoo?.(payload)` |

**Custom hooks** (`useResizable`, `useMove`, `useLeave` in `ResizablePanel.tsx`) → Svelte actions
(`function resizable(node, params) {...}` used via `use:resizable`) or `.svelte.ts` rune helpers.

## Component inventory (by complexity)

### Primitives / reference set (port first — defines patterns)
- `Logo.tsx` (32) — pure SVG, props only
- `Copyable.tsx` (49) — useState + children + lucide
- `TabContainer.tsx` (58) — children/snippets
- `Bubble.tsx` (132) — refs, pointer events, signals
- `Panel.tsx` (296) — composition hub

### Mount layer
- `Widget.tsx` (56) → `Widget.svelte` + mount swap
- `Layout.tsx` (138)
- `ResizablePanel.tsx` (176) — custom hooks → actions

### Views (fan-out candidates — mostly independent)
- `TracesView.tsx` (966)
- `ServiceMapView.tsx` (823)
- `SpanDetailPanel.tsx` (672)
- `WaterfallView.tsx` (624)
- `FlameGraphView.tsx` (441)
- `ErrorsView.tsx` (287)
- `LogsView.tsx` (223)
- `GenAiView.tsx` (195) + `genai/ConversationPanel.tsx` (309), `genai/AgentTimeline.tsx` (215), `genai/ModelHeader.tsx` (133)
- `TraceImportModal.tsx` (172)
- `ResourcesView.tsx` (142)
- `MetricsView.tsx` (137)
- `SpanSearch.tsx` (134)
- `SnapshotBar.tsx` (119)
- `KeyboardShortcutsHelp.tsx` (100)
- `JsonTree.tsx` (93)

### Stories + tests (port last, against working components)
- 10 `*.stories.tsx`, 10 `src/widget/__tests__/*` files

## Build/dep swaps

- Remove: `preact`, `@preact/signals`, `lucide-preact`, `@preact/preset-vite`, `@storybook/preact-vite`, `@testing-library/preact`, `react`, `react-dom`, `markdown-to-jsx`
- Add: `svelte`, `lucide-svelte`, `@sveltejs/vite-plugin-svelte`, `@storybook/svelte-vite`, `@testing-library/svelte` / `vitest-browser-svelte`, a Svelte markdown renderer (or keep `markdown-to-jsx` only inside a `{@html}` sanitised path — TBD)
- `svelte.config.js` (vitePreprocess), `svelte-check` for type-checking `.svelte`
- `tsconfig.json`: drop `jsx`/`jsxImportSource` preact settings
- `vite.widget.config.ts`: `preact()` → `svelte()`
- `.storybook/main.ts`: framework `@storybook/svelte-vite`
- `tsup.config.ts`: **unchanged** (server build only)

## Verification gates
- `pnpm build` (tsup server + vite widget IIFE) green
- `svelte-check` green
- `pnpm test` (vitest unit + storybook) green
- Manual: widget mounts in shadow root, styles apply, traces/logs/metrics render, theme cycles, drag/resize work
