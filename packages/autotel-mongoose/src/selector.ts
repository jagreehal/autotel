import type { MethodSelector } from './types.js';

/**
 * Evaluates whether a named function in a category should be instrumented.
 * Supports boolean, include-list, and `{ include, exclude }` selectors.
 */
export function selectorAllows(
  selector: MethodSelector,
  name: string,
): boolean {
  if (selector === false) {
    return false;
  }
  if (selector === true) {
    return true;
  }
  if (Array.isArray(selector)) {
    return selector.includes(name);
  }
  if (selector.include && !selector.include.includes(name)) {
    return false;
  }
  if (selector.exclude && selector.exclude.includes(name)) {
    return false;
  }
  return true;
}
