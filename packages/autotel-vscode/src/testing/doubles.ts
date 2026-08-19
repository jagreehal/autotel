/**
 * Stand-ins for the VS Code objects the extension is handed.
 *
 * `activate()` receives an ExtensionContext from the editor, whose type
 * describes far more than an extension reads. Building it here means the
 * assertion is stated once, next to what it knows.
 */
import type { ExtensionContext } from 'vscode';
import type { Mock } from 'vitest';

/** What the extension puts its disposables on. */
export interface Disposables {
  subscriptions: Array<{ dispose(): void }>;
}

/** An ExtensionContext carrying the members the extension reads. */
export function extensionContext(
  extras: { extensionUri?: { fsPath: string } } = {},
): ExtensionContext & Disposables {
  // SAFETY: activate() registers its disposables on `subscriptions` and reads
  // `extensionUri` when it needs a bundled asset; the rest of the interface
  // belongs to the editor and is never reached from a test.
  const context: Disposables & typeof extras = { subscriptions: [], ...extras };
  // SAFETY: see above - only `subscriptions` and `extensionUri` are reached.
  return context as ExtensionContext & Disposables;
}

/** Installs a spy as the global fetch, for the backend adapter tests. */
export function installFetch(spy: Mock): void {
  // SAFETY: a vitest mock is not the DOM's fetch type; the adapters call
  // fetch(url, init) and read `ok`, `status` and `json()` off what it resolves
  // to, which is what these tests' stubs provide.
  globalThis.fetch = spy as unknown as typeof fetch;
}
