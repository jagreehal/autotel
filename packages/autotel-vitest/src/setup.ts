/**
 * autotel-vitest/setup
 *
 * The per-test span without changing a single test file: list this module in
 * `setupFiles` and every test gets the span the `test` fixture would give it.
 * Use one or the other, not both, or each test gets two spans.
 *
 * @example
 * // vitest.config.ts
 * setupFiles: ['./vitest.setup.ts', 'autotel-vitest/setup'],
 */
import { aroundEach } from 'vitest';
import { context as otelContext } from 'autotel';

import { runInTestSpan, startTestSpan } from './fixture';

// Unlike a fixture's `use()`, `runTest()` runs the test body on this call's
// stack, so `context.with` reaches it.
aroundEach(async (runTest, { task, annotate }) => {
  const { span, ctx } = startTestSpan(task);
  await runInTestSpan(task, span, annotate, () =>
    otelContext.with(ctx, runTest),
  );
});
