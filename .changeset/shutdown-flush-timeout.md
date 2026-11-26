---
'autotel': patch
---

`shutdown()` resolves with a warning when the final flush times out or finds no collector, so your app exits cleanly when no collector is running. Other flush errors still reject.
