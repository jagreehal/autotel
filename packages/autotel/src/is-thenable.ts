/**
 * Convert anything `await` would wait on into a native Promise, or return
 * `undefined` for a synchronous value.
 *
 * `instanceof Promise` is not enough. ORM query builders (drizzle, knex,
 * Prisma, Sequelize) are lazy thenables that are not native Promises, and a
 * promise created in another realm fails the check too. Treating those as
 * synchronous ends the span before the work runs, which produces a short
 * parent span with its real children orphaned outside it.
 */
export function promiseFromThenable<T>(
  value: T,
): Promise<Awaited<T>> | undefined {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return undefined;
  }

  let then: unknown;
  try {
    then = (value as { then?: unknown }).then;
  } catch (error) {
    return Promise.reject(error);
  }
  if (typeof then !== 'function') return undefined;

  return new Promise<Awaited<T>>((resolve, reject) => {
    try {
      then.call(value, resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}
