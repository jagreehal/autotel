---
'autotel-mongoose': patch
---

fix(autotel-mongoose): stop callback-style hooks leaking their span context to sibling hooks

Under Kareem's callback protocol (Mongoose < 8), a hook that calls `next()` from
inside its own async continuation — e.g. `Model.findById(...).then(next)` in a
pre-save hook — still had its span active when Kareem synchronously advanced the
chain. The next sibling hook, and every query span it opened, were therefore
parented to the previous hook's already-ended span, producing deeply mis-nested
traces (sibling `pre('save')` hooks nested under each other; `post('save')` spans
nested under `pre('save')`). The wrapped `next` now restores the parent context
before handing control back to Kareem, keeping sibling hooks as siblings.
