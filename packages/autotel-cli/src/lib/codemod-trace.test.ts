import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { transformFile } from './codemod-trace';

const FIXTURE_PATH = '/fake/src/example.ts';

describe('ts-morph default export (diagnostic)', () => {
  it('detects export default function via getExportedDeclarations', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      'example.ts',
      'export default function createUser() { return 1; }'
    );
    const defaultDecls = sourceFile.getExportedDeclarations().get('default');
    const fns = sourceFile.getFunctions();
    expect(defaultDecls?.length, 'default export declarations').toBe(1);
    expect(fns.length, 'getFunctions should return 1 for single default export fn').toBe(1);
  });
});

describe('transformFile', () => {
  it('wraps function declaration with trace and adds import', () => {
    const input = `function createUser(data: string) {
  return data;
}
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(true);
    expect(result.wrappedCount).toBe(1);
    expect(result.modified).toMatch(/import\s*\{\s*trace\s*\}\s*from\s*['"]autotel['"]/);
    expect(result.modified).toContain("const createUser = trace('createUser', function createUser(data: string)");
    expect(result.modified).toContain('return data;');
  });

  it('wraps export function declaration', () => {
    const input = `export function createUser(data: string) {
  return data;
}
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(true);
    expect(result.wrappedCount).toBe(1);
    expect(result.modified).toContain('export const createUser = trace');
  });

  it('wraps arrow function in const', () => {
    const input = `const createUser = async (data: string) => {
  return data;
};
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(true);
    expect(result.wrappedCount).toBe(1);
    expect(result.modified).toContain("trace('createUser', async (data: string) =>");
  });

  it('skips already wrapped function', () => {
    const input = `import { trace } from 'autotel';
const createUser = trace('createUser', async (data: string) => {
  return data;
});
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(false);
    expect(result.wrappedCount).toBe(0);
    expect(result.skipped.some((s) => s.reason === 'already wrapped')).toBe(true);
  });

  it('skips function when name matches --skip regex', () => {
    const input = `function _internal() {
  return 1;
}
`;
    const result = transformFile(input, FIXTURE_PATH, { skip: [/^_/] });
    expect(result.changed).toBe(false);
    expect(result.wrappedCount).toBe(0);
    expect(result.skipped.some((s) => s.reason === 'name match')).toBe(true);
  });

  it('applies name-pattern for span name', () => {
    const input = `function createUser() {
  return 1;
}
`;
    const result = transformFile(input, FIXTURE_PATH, { namePattern: '{file}.{name}' });
    expect(result.changed).toBe(true);
    expect(result.modified).toContain("trace('example.createUser'");
  });

  it('does not modify file when no eligible functions', () => {
    const input = `const x = 1;
export default x;
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(false);
    expect(result.wrappedCount).toBe(0);
    expect(result.modified).toBe(input);
  });

  it('does not add import when no functions wrapped (no-op guarantee)', () => {
    const input = `function _helper() {}
`;
    const result = transformFile(input, FIXTURE_PATH, { skip: [/^_/] });
    expect(result.changed).toBe(false);
    expect(result.modified).not.toContain("from 'autotel'");
  });

  it('wraps class method body', () => {
    const input = `class UserService {
  async createUser(data: string) {
    return data;
  }
}
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(true);
    expect(result.wrappedCount).toBe(1);
    expect(result.modified).toContain("trace('UserService.createUser'");
    expect(result.modified).toContain('return data;');
  });

  it('skips constructor', () => {
    const input = `class C {
  constructor() {
    this.x = 1;
  }
}
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(false);
    expect(result.skipped.some((s) => s.reason === 'constructor')).toBe(true);
  });

  it('wraps default export function', () => {
    const input = `export default function createUser() {
  return 1;
}
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(true);
    expect(result.wrappedCount).toBe(1);
    expect(result.modified).toContain('const createUser = trace');
    expect(result.modified).toContain('export default createUser');
  });

  it('skips anonymous default export', () => {
    const input = `export default function () {
  return 1;
}
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(false);
    expect(result.skipped.some((s) => s.reason === 'anonymous default export')).toBe(true);
  });

  it('wraps default export and other named functions without double-editing default', () => {
    // When a file has both "export default function createUser()" and "function helper()",
    // the codemod must not add two edits for the same default-export node (step 1 as
    // regular fn + step 2 as default). Result must have exactly one export default and
    // both functions wrapped.
    const input = `export default function createUser() {
  return 1;
}
function helper() {
  return 2;
}
`;
    const result = transformFile(input, FIXTURE_PATH, {});
    expect(result.changed).toBe(true);
    expect(result.wrappedCount).toBe(2);

    // Must contain exactly one "export default createUser" (no duplicate or missing)
    const exportDefaultCount = (result.modified.match(/export\s+default\s+createUser/g) ?? []).length;
    expect(exportDefaultCount).toBe(1);

    expect(result.modified).toContain('const createUser = trace');
    expect(result.modified).toContain('export default createUser');
    expect(result.modified).toContain('const helper = trace');
  });
});
