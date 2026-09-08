---
'autotel-devtools': patch
---

Keyboard shortcuts in the viewer now yield to whatever you are typing.

The widget renders in a shadow root, where `document.activeElement` names the host element rather than the input holding the caret. `isInputFocused` walks `shadowRoot.activeElement` down to the element that really has focus, and every global handler routes through it — the trace-detail view keys, the digits that switch tab, `/`, `Cmd+A`. Typing `l` into the attribute filter filters for `l`.

Waterfall row lookups are scoped to the scroll container for the same reason, so arrow-key navigation scrolls the span it selects into view.
