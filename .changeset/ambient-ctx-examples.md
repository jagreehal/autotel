---
'autotel': patch
---

Show one tracing shape across the examples, the agent docs, and the skill.

Reusable work is wrapped with `trace('operation.name', fn)`, and the span is
read through the ambient `ctx` import:

```ts
import { trace, ctx } from 'autotel';

export const createUser = trace('user.create', async (data) => {
  ctx.setAttribute('user.id', data.id);
  return db.users.create(data);
});
```

`ctx` resolves the active span at property access, so a helper several frames
inside a traced body reaches the same span without being handed anything, and
`getRequestLogger()` reads that span when called with no arguments.

`withTracing({ name })((ctx) => fn)` keeps its place for wrappers that want the
context as an argument, and `instrument({ key, fn })` remains the options form
of the wrapper. `AGENTS.md`, `docs/AGENT-GUIDE.md` and
`.claude/skills/autotel` now name when each one fits.

The `apps/book-chapters` examples run on these forms, under explicit span
names, and `pnpm --filter @autotel/book-chapters test` covers every one.
