import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformFile } from './codemod-trace';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../__fixtures__/codemod-trace');

function loadFixture(category: string, name: string, type: 'before' | 'after'): string {
  const filePath = path.join(FIXTURES_DIR, category, type, name);
  return fs.readFileSync(filePath, 'utf8');
}

function getFixtureFiles(category: string): string[] {
  const beforeDir = path.join(FIXTURES_DIR, category, 'before');
  if (!fs.existsSync(beforeDir)) return [];
  return fs.readdirSync(beforeDir);
}

describe('codemod-trace fixtures', () => {
  describe('transformations', () => {
    const fixtures = getFixtureFiles('transformations');

    it.each(fixtures)('transforms %s', (fixture) => {
      const before = loadFixture('transformations', fixture, 'before');
      const expected = loadFixture('transformations', fixture, 'after');
      const result = transformFile(before, `/fake/src/${fixture}`, {});

      expect(result.changed).toBe(true);
      expect(result.wrappedCount).toBeGreaterThan(0);
      expect(result.modified.trim()).toBe(expected.trim());
    });
  });

  describe('skip-scenarios', () => {
    const fixtures = getFixtureFiles('skip-scenarios');

    it.each(fixtures)('handles skip scenario: %s', (fixture) => {
      const before = loadFixture('skip-scenarios', fixture, 'before');
      const expected = loadFixture('skip-scenarios', fixture, 'after');
      const result = transformFile(before, `/fake/src/${fixture}`, {});

      // Verify the transformation matches expected output
      expect(result.modified.trim()).toBe(expected.trim());
    });

    it('skips already wrapped functions', () => {
      const before = loadFixture('skip-scenarios', 'already-wrapped.ts', 'before');
      const result = transformFile(before, '/fake/src/already-wrapped.ts', {});

      expect(result.changed).toBe(false);
      expect(result.wrappedCount).toBe(0);
      expect(result.skipped.some((s) => s.reason === 'already wrapped')).toBe(true);
    });

    it('skips constructors', () => {
      const before = loadFixture('skip-scenarios', 'constructor.ts', 'before');
      const result = transformFile(before, '/fake/src/constructor.ts', {});

      expect(result.changed).toBe(false);
      expect(result.skipped.some((s) => s.reason === 'constructor')).toBe(true);
    });

    it('skips generator methods', () => {
      const before = loadFixture('skip-scenarios', 'generator-method.ts', 'before');
      const result = transformFile(before, '/fake/src/generator-method.ts', {});

      expect(result.changed).toBe(false);
      expect(result.skipped.some((s) => s.reason === 'generator')).toBe(true);
    });

    it('skips getters and setters', () => {
      const before = loadFixture('skip-scenarios', 'getter-setter.ts', 'before');
      const result = transformFile(before, '/fake/src/getter-setter.ts', {});

      expect(result.changed).toBe(false);
      // Note: current implementation may not explicitly record getter/setter skips
    });

    it('skips methods with super calls', () => {
      const before = loadFixture('skip-scenarios', 'method-with-super.ts', 'before');
      const result = transformFile(before, '/fake/src/method-with-super.ts', {});

      // Base class method gets wrapped, derived class with super is skipped
      expect(result.skipped.some((s) => s.reason === 'super')).toBe(true);
    });

    it('skips anonymous default exports', () => {
      const before = loadFixture('skip-scenarios', 'anonymous-default.ts', 'before');
      const result = transformFile(before, '/fake/src/anonymous-default.ts', {});

      expect(result.changed).toBe(false);
      expect(result.skipped.some((s) => s.reason === 'anonymous default export')).toBe(true);
    });

    it('handles mixed wrap/skip scenarios', () => {
      const before = loadFixture('skip-scenarios', 'mixed-wrap-skip.ts', 'before');
      const result = transformFile(before, '/fake/src/mixed-wrap-skip.ts', {});

      // Some functions wrapped, some skipped
      expect(result.wrappedCount).toBeGreaterThan(0);
      expect(result.skipped.length).toBeGreaterThan(0);
    });
  });

  describe('typescript', () => {
    const fixtures = getFixtureFiles('typescript');

    it.each(fixtures)('transforms TypeScript: %s', (fixture) => {
      const before = loadFixture('typescript', fixture, 'before');
      const expected = loadFixture('typescript', fixture, 'after');
      const result = transformFile(before, `/fake/src/${fixture}`, {});

      expect(result.changed).toBe(true);
      expect(result.modified.trim()).toBe(expected.trim());
    });

    it('preserves generics', () => {
      const before = loadFixture('typescript', 'generics.ts', 'before');
      const result = transformFile(before, '/fake/src/generics.ts', {});

      expect(result.changed).toBe(true);
      // Check that generic type parameters are preserved
      expect(result.modified).toContain('<T>');
      expect(result.modified).toContain('<T, U>');
    });

    it('handles function overloads', () => {
      const before = loadFixture('typescript', 'overloads.ts', 'before');
      const result = transformFile(before, '/fake/src/overloads.ts', {});

      expect(result.changed).toBe(true);
      // Only the implementation function is wrapped, not the overload signatures
      expect(result.wrappedCount).toBe(1);
    });

    it('preserves return types', () => {
      const before = loadFixture('typescript', 'return-types.ts', 'before');
      const result = transformFile(before, '/fake/src/return-types.ts', {});

      expect(result.changed).toBe(true);
      expect(result.modified).toContain('Promise<User>');
      expect(result.modified).toContain('User | null');
    });
  });

  describe('jsx', () => {
    const fixtures = getFixtureFiles('jsx');

    it.each(fixtures)('transforms JSX: %s', (fixture) => {
      const before = loadFixture('jsx', fixture, 'before');
      const expected = loadFixture('jsx', fixture, 'after');
      const result = transformFile(before, `/fake/src/${fixture}`, {});

      expect(result.changed).toBe(true);
      expect(result.modified.trim()).toBe(expected.trim());
    });

    it('preserves JSX syntax in function components', () => {
      const before = loadFixture('jsx', 'component-function.tsx', 'before');
      const result = transformFile(before, '/fake/src/component-function.tsx', {});

      expect(result.changed).toBe(true);
      expect(result.modified).toContain('<button');
      expect(result.modified).toContain('onClick={onClick}');
    });
  });

  describe('imports', () => {
    it('adds trace import when none exists', () => {
      const before = loadFixture('imports', 'no-existing-import.ts', 'before');
      const expected = loadFixture('imports', 'no-existing-import.ts', 'after');
      const result = transformFile(before, '/fake/src/no-existing-import.ts', {});

      expect(result.changed).toBe(true);
      expect(result.modified).toContain("import { trace } from");
      expect(result.modified.trim()).toBe(expected.trim());
    });

    it('does not duplicate existing trace import', () => {
      const before = loadFixture('imports', 'existing-trace-import.ts', 'before');
      const expected = loadFixture('imports', 'existing-trace-import.ts', 'after');
      const result = transformFile(before, '/fake/src/existing-trace-import.ts', {});

      expect(result.changed).toBe(true);
      // Count occurrences of trace import - should only be one
      const traceImportMatches = result.modified.match(/import.*trace.*from.*autotel/g);
      expect(traceImportMatches?.length).toBe(1);
      expect(result.modified.trim()).toBe(expected.trim());
    });

    it('adds trace to existing autotel import', () => {
      const before = loadFixture('imports', 'existing-other-import.ts', 'before');
      const expected = loadFixture('imports', 'existing-other-import.ts', 'after');
      const result = transformFile(before, '/fake/src/existing-other-import.ts', {});

      expect(result.changed).toBe(true);
      // Should have trace import (added) and init import (original)
      expect(result.modified).toContain("import { trace }");
      expect(result.modified).toContain("import { init }");
      expect(result.modified.trim()).toBe(expected.trim());
    });
  });

  describe('name-patterns', () => {
    it('uses function name only by default', () => {
      const before = loadFixture('name-patterns', 'basic.ts', 'before');
      const result = transformFile(before, '/fake/src/basic.ts', {});

      expect(result.modified).toContain("trace('createUser'");
      expect(result.modified).toContain("trace('updateUser'");
    });

    it('applies {name} pattern', () => {
      const before = loadFixture('name-patterns', 'basic.ts', 'before');
      const result = transformFile(before, '/fake/src/basic.ts', { namePattern: '{name}' });

      expect(result.modified).toContain("trace('createUser'");
      expect(result.modified).toContain("trace('updateUser'");
    });

    it('applies {file}.{name} pattern', () => {
      const before = loadFixture('name-patterns', 'basic.ts', 'before');
      const result = transformFile(before, '/fake/src/basic.ts', { namePattern: '{file}.{name}' });

      expect(result.modified).toContain("trace('basic.createUser'");
      expect(result.modified).toContain("trace('basic.updateUser'");
    });

    it('applies {path}:{name} pattern', () => {
      const before = loadFixture('name-patterns', 'basic.ts', 'before');
      // Use a path that's relative to cwd for predictable output
      const cwd = process.cwd();
      const filePath = path.join(cwd, 'src/users/basic.ts');
      const result = transformFile(before, filePath, { namePattern: '{path}:{name}' });

      expect(result.modified).toContain("trace('src/users/basic.ts:createUser'");
      expect(result.modified).toContain("trace('src/users/basic.ts:updateUser'");
    });
  });

  describe('skip option', () => {
    it('skips functions matching --skip regex', () => {
      const input = `
function _internal() { return 1; }
function publicFn() { return 2; }
`;
      const result = transformFile(input, '/fake/src/test.ts', { skip: [/^_/] });

      expect(result.wrappedCount).toBe(1);
      expect(result.skipped.some((s) => s.name === '_internal' && s.reason === 'name match')).toBe(true);
      expect(result.modified).toContain("trace('publicFn'");
      expect(result.modified).not.toContain("trace('_internal'");
    });

    it('skips multiple patterns', () => {
      const input = `
function _internal() { return 1; }
function helperFn() { return 2; }
function publicFn() { return 3; }
`;
      const result = transformFile(input, '/fake/src/test.ts', { skip: [/^_/, /helper/] });

      expect(result.wrappedCount).toBe(1);
      expect(result.skipped.filter((s) => s.reason === 'name match').length).toBe(2);
    });
  });

  describe('javascript', () => {
    const fixtures = getFixtureFiles('javascript');

    it.each(fixtures)('transforms JavaScript: %s', (fixture) => {
      const before = loadFixture('javascript', fixture, 'before');
      const expected = loadFixture('javascript', fixture, 'after');
      const result = transformFile(before, `/fake/src/${fixture}`, {});

      expect(result.changed).toBe(true);
      expect(result.modified.trim()).toBe(expected.trim());
    });

    it('transforms plain JS function declarations', () => {
      const before = loadFixture('javascript', 'function-declaration.js', 'before');
      const result = transformFile(before, '/fake/src/function-declaration.js', {});

      expect(result.changed).toBe(true);
      expect(result.modified).toContain("trace('createUser'");
      expect(result.modified).toContain("import { trace } from");
    });

    it('transforms JS arrow functions', () => {
      const before = loadFixture('javascript', 'arrow-function.js', 'before');
      const result = transformFile(before, '/fake/src/arrow-function.js', {});

      expect(result.changed).toBe(true);
      expect(result.modified).toContain("trace('createUser'");
    });

    it('transforms JS class methods', () => {
      const before = loadFixture('javascript', 'class-method.js', 'before');
      const result = transformFile(before, '/fake/src/class-method.js', {});

      expect(result.changed).toBe(true);
      expect(result.modified).toContain("trace('UserService.createUser'");
    });

    it('transforms JSX components', () => {
      const before = loadFixture('javascript', 'component.jsx', 'before');
      const result = transformFile(before, '/fake/src/component.jsx', {});

      expect(result.changed).toBe(true);
      expect(result.modified).toContain("trace('Button'");
      expect(result.modified).toContain('<button');
    });
  });
});
