---
'autotel-devtools': patch
'autotel-tanstack': patch
'autotel': patch
---

Restructure the DevTools widget UX and add a configurable TanStack instrument() preset.

- **autotel-devtools**: extract reusable abstractions (`useListKeyboardNav`, `useZoomPan`, `matchesNeedle`, `SearchInput`), decompose the `Panel` and restore its resize UX, unify the drag mechanic and tab bar across surfaces so no view is unreachable, and collapse the pause-buffer into a stream table.
- **autotel-tanstack**: add a configurable `instrument()` preset; `auto.ts` now delegates to it.
- **autotel**: export `isInitialized` from the package entry point.
