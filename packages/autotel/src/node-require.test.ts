import { afterEach, describe, expect, it } from 'vitest';
import { requireModule } from './node-require';

describe('requireModule', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__filename');
  });

  it('loads a module when the host defines a global __filename such as node -e', () => {
    // `node -e` and the REPL put a non-path __filename on the global object.
    // The require is built on first use, so this is its first call.
    Object.assign(globalThis, { __filename: '[eval]' });

    expect(requireModule<{ sep: string }>('node:path').sep).toBeTypeOf(
      'string',
    );
  });
});
