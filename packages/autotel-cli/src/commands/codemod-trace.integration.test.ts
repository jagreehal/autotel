import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveCodemodFiles } from './codemod-trace';

describe('resolveCodemodFiles', () => {
  let tempDir: string;

  beforeAll(() => {
    // Create a temporary directory structure for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-trace-test-'));

    // Create directory structure
    const dirs = [
      'src',
      'src/utils',
      'src/components',
      'lib',
      'node_modules/some-package',
    ];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(tempDir, dir), { recursive: true });
    }

    // Create test files
    const files = [
      'src/index.ts',
      'src/app.tsx',
      'src/utils/helpers.ts',
      'src/utils/helpers.d.ts',
      'src/components/Button.tsx',
      'src/components/Button.test.ts',
      'lib/legacy.js',
      'lib/legacy.jsx',
      'node_modules/some-package/index.ts',
      'config.json',
      'README.md',
    ];
    for (const file of files) {
      fs.writeFileSync(path.join(tempDir, file), `// ${file}`, 'utf8');
    }
  });

  afterAll(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('single file resolution', () => {
    it('resolves a single TypeScript file', async () => {
      const files = await resolveCodemodFiles('src/index.ts', tempDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(path.join(tempDir, 'src/index.ts'));
    });

    it('resolves a single TSX file', async () => {
      const files = await resolveCodemodFiles('src/app.tsx', tempDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(path.join(tempDir, 'src/app.tsx'));
    });

    it('resolves a single JavaScript file', async () => {
      const files = await resolveCodemodFiles('lib/legacy.js', tempDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(path.join(tempDir, 'lib/legacy.js'));
    });

    it('resolves a single JSX file', async () => {
      const files = await resolveCodemodFiles('lib/legacy.jsx', tempDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(path.join(tempDir, 'lib/legacy.jsx'));
    });

    it('returns empty array for non-code files', async () => {
      const files = await resolveCodemodFiles('config.json', tempDir);
      expect(files).toHaveLength(0);
    });

    it('returns empty array for markdown files', async () => {
      const files = await resolveCodemodFiles('README.md', tempDir);
      expect(files).toHaveLength(0);
    });

    it('returns empty array for non-existent files', async () => {
      const files = await resolveCodemodFiles('src/nonexistent.ts', tempDir);
      expect(files).toHaveLength(0);
    });
  });

  describe('glob pattern resolution', () => {
    it('resolves all TypeScript files in a directory', async () => {
      const files = await resolveCodemodFiles('src/**/*.ts', tempDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f) => f.endsWith('.ts'))).toBe(true);
    });

    it('resolves all TSX files in a directory', async () => {
      const files = await resolveCodemodFiles('src/**/*.tsx', tempDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f) => f.endsWith('.tsx'))).toBe(true);
    });

    it('resolves all TypeScript and TSX files with brace expansion', async () => {
      const files = await resolveCodemodFiles('src/**/*.{ts,tsx}', tempDir);
      expect(files.length).toBeGreaterThan(1);
      expect(files.every((f) => f.endsWith('.ts') || f.endsWith('.tsx'))).toBe(true);
    });

    it('resolves files in specific subdirectory', async () => {
      const files = await resolveCodemodFiles('src/utils/*.ts', tempDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f) => f.includes('src/utils/'))).toBe(true);
    });
  });

  describe('.d.ts exclusion', () => {
    it('excludes .d.ts files when using single file path', async () => {
      const files = await resolveCodemodFiles('src/utils/helpers.d.ts', tempDir);
      expect(files).toHaveLength(0);
    });

    it('excludes .d.ts files when using glob patterns', async () => {
      const files = await resolveCodemodFiles('src/**/*.ts', tempDir);
      expect(files.every((f) => !f.endsWith('.d.ts'))).toBe(true);
    });
  });

  describe('node_modules exclusion', () => {
    it('excludes node_modules when using glob patterns', async () => {
      const files = await resolveCodemodFiles('**/*.ts', tempDir);
      expect(files.every((f) => !f.includes('node_modules'))).toBe(true);
    });
  });

  describe('absolute paths', () => {
    it('resolves absolute file paths', async () => {
      const absolutePath = path.join(tempDir, 'src/index.ts');
      const files = await resolveCodemodFiles(absolutePath, tempDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(absolutePath);
    });

    it('resolves absolute glob patterns', async () => {
      const absolutePattern = path.join(tempDir, 'src/**/*.ts');
      const files = await resolveCodemodFiles(absolutePattern, tempDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f) => f.startsWith(tempDir))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for pattern matching no files', async () => {
      const files = await resolveCodemodFiles('src/**/*.cpp', tempDir);
      expect(files).toHaveLength(0);
    });

    it('handles patterns with multiple extensions', async () => {
      const files = await resolveCodemodFiles('**/*.{ts,tsx,js,jsx}', tempDir);
      const extensions = new Set(files.map((f) => path.extname(f)));
      expect(extensions.size).toBeGreaterThan(1);
    });
  });
});
