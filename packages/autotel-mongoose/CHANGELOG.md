# autotel-mongoose

## 0.0.2

### Patch Changes

- c5f8615: Fix mongoose hook instrumentation to properly handle callback-style hooks by preserving function arity and wrapping the `next` callback for span finalization. Also filter out additional internal Mongoose timestamp hooks to prevent double-wrapping.
