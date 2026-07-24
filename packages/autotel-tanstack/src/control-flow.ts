/**
 * TanStack Router control-flow signal detection.
 *
 * `redirect()` and `notFound()` are throw-based navigation signals: the
 * framework catches them and turns them into a real response. They are not
 * application errors, so instrumentation must not record them on a span or
 * report them to the error store.
 *
 * We match TanStack's own public predicate shapes rather than importing
 * `isRedirect`/`isNotFound`, so the check works for both React Start and Solid
 * Start without a hard dependency on a specific `@tanstack` package:
 *
 *   - `redirect()` throws a `Response` carrying an `.options` bag
 *     (`@tanstack/router-core` `isRedirect`).
 *   - `notFound()` throws a plain object with `isNotFound === true`
 *     (`@tanstack/router-core` `isNotFound`).
 *
 * The `name`-based branch keeps older TanStack versions covered, which threw
 * `RedirectError` / `NotFoundError` instances instead.
 */
export function isControlFlowSignal(error: unknown): boolean {
  if (
    typeof Response !== 'undefined' &&
    error instanceof Response &&
    (error as { options?: unknown }).options != null
  ) {
    return true;
  }

  if (typeof error === 'object' && error !== null) {
    if ((error as { isNotFound?: unknown }).isNotFound === true) {
      return true;
    }
    const name = (error as { name?: unknown }).name;
    if (name === 'RedirectError' || name === 'NotFoundError') {
      return true;
    }
  }

  return false;
}
