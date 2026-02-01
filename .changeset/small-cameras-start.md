---
'autotel-cli': patch
---

Fix trace codemod double-editing default export when a file has both `export default function` and other named functions. Step 1 now skips the default-export function so it is only edited in step 2, avoiding "node was removed or forgotten" when applying edits.
