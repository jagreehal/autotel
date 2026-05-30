/**
 * Runes-backed signal shim.
 *
 * Re-implements the slice of the `@preact/signals` API the widget uses
 * (`signal`, `computed`, `effect`) on top of Svelte 5 runes, preserving the
 * `.value` get/set surface. This lets `store.svelte.ts` and every component keep
 * their `xxxSignal.value` reads/writes unchanged — reading `.value` inside a
 * `.svelte` template or a `$derived` is reactive because the getter touches a
 * `$state`/`$derived` field.
 *
 * NOTE: this file MUST keep the `.svelte.ts` extension so the compiler
 * processes the runes inside it.
 */

export class Signal<T> {
  #v: T = $state(undefined as T);

  constructor(initial: T) {
    this.#v = initial;
  }

  get value(): T {
    return this.#v;
  }

  set value(next: T) {
    this.#v = next;
  }
}

export class Computed<T> {
  #compute: () => T;
  // Lazy: the deriver closure reads `#compute` only when `.value` is accessed,
  // by which point the constructor has assigned it.
  #v: T = $derived.by(() => this.#compute());

  constructor(compute: () => T) {
    this.#compute = compute;
  }

  get value(): T {
    return this.#v;
  }
}

export function signal<T>(value: T): Signal<T> {
  return new Signal<T>(value);
}

export function computed<T>(compute: () => T): Computed<T> {
  return new Computed<T>(compute);
}

/**
 * Run a side effect that re-runs when the signals it reads change. Returns a
 * disposer (matching `@preact/signals`' `effect`). Backed by `$effect.root` so
 * it can be created at module scope, outside any component.
 */
export function effect(fn: () => void | (() => void)): () => void {
  return $effect.root(() => {
    $effect(fn);
  });
}
