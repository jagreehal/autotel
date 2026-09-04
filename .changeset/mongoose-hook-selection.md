---
'autotel-mongoose': minor
---

Choose which schema hooks to trace, and name their spans after the operation.

`instrumentHooks` accepts a selector, the same shape `customMethods` takes:

```ts
instrumentHooks: ['save', 'validate']; // only these
instrumentHooks: {
  exclude: ['init'];
} // everything else
```

Reach for it with `init`, which runs once for every document a query hydrates,
where `save` and `validate` run once per operation. `true` and `false` behave as
before.

Hook spans are named after the operation that ran, for every registration form
Mongoose accepts: `pre(['save', 'validate'], fn)` gives `pre.save` and
`pre.validate`, and `pre(/^find/, fn)` gives `pre.find` or `pre.findOne`. Both
forms answer to the selector one operation at a time, and excluding a hook only
stops its span — the handler still runs.

Tracing covers the hooks an application registers. Mongoose's own hooks stay out
of the way, so a schema using `timestamps`, subdocuments or virtuals emits spans
only for the hooks you wrote.

`instrumentMongoose()` is safe to call more than once. Mongoose's `Model` and
`Query` prototypes are shared by every `new mongoose.Mongoose()`, so a second
call recognises what the first installed and leaves it alone: one span per
operation either way.

Methods Mongoose implements with other methods produce one span, not one per
delegation: `findById` traces as `findById`, without a nested `findOne` for the
same round trip. A query a hook issues is a separate round trip and keeps its
own span.
