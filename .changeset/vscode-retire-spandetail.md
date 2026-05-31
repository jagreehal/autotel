---
'autotel-vscode': minor
---

Retire the bespoke Preact span-detail webview. Clicking a span (tree node or CodeLens) now deep-links into the embedded `autotel-devtools` widget focused on that span (`#trace=…&span=…`), giving the full waterfall / Flow / GenAI view instead of a single-span panel. Removes the `src/webview` UI, the Vite webview build step, and the `preact` / `vite` toolchain — the extension now builds with `tsup` alone.
