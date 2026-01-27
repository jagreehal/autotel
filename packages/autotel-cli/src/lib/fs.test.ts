import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  isPathWithinRoot,
  fileExists,
  dirExists,
  readFileSafe,
  readJsonSafe,
  atomicWrite,
  createBackup,
  findUpward,
} from './fs';

describe('fs utilities', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isPathWithinRoot', () => {
    it('should return true for path within root', () => {
      expect(isPathWithinRoot(path.join(tempDir, 'file.txt'), tempDir)).toBe(true);
    });

    it('should return true for nested path within root', () => {
      expect(isPathWithinRoot(path.join(tempDir, 'a', 'b', 'c.txt'), tempDir)).toBe(true);
    });

    it('should return false for path outside root', () => {
      expect(isPathWithinRoot('/etc/passwd', tempDir)).toBe(false);
    });

    it('should return false for path traversal attempt', () => {
      expect(isPathWithinRoot(path.join(tempDir, '..', 'other'), tempDir)).toBe(false);
    });

    it('should return true for root itself', () => {
      expect(isPathWithinRoot(tempDir, tempDir)).toBe(true);
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'content');
      expect(fileExists(filePath)).toBe(true);
    });

    it('should return false for non-existing file', () => {
      expect(fileExists(path.join(tempDir, 'nonexistent.txt'))).toBe(false);
    });

    it('should return false for directory', () => {
      expect(fileExists(tempDir)).toBe(false);
    });
  });

  describe('dirExists', () => {
    it('should return true for existing directory', () => {
      expect(dirExists(tempDir)).toBe(true);
    });

    it('should return false for non-existing directory', () => {
      expect(dirExists(path.join(tempDir, 'nonexistent'))).toBe(false);
    });

    it('should return false for file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'content');
      expect(dirExists(filePath)).toBe(false);
    });
  });

  describe('readFileSafe', () => {
    it('should read existing file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'hello world');
      expect(readFileSafe(filePath)).toBe('hello world');
    });

    it('should return null for non-existing file', () => {
      expect(readFileSafe(path.join(tempDir, 'nonexistent.txt'))).toBeNull();
    });
  });

  describe('readJsonSafe', () => {
    it('should parse valid JSON', () => {
      const filePath = path.join(tempDir, 'test.json');
      fs.writeFileSync(filePath, '{"name": "test", "version": "1.0.0"}');
      const result = readJsonSafe<{ name: string; version: string }>(filePath);
      expect(result).toEqual({ name: 'test', version: '1.0.0' });
    });

    it('should return null for invalid JSON', () => {
      const filePath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(filePath, 'not json');
      expect(readJsonSafe(filePath)).toBeNull();
    });

    it('should return null for non-existing file', () => {
      expect(readJsonSafe(path.join(tempDir, 'nonexistent.json'))).toBeNull();
    });
  });

  describe('atomicWrite', () => {
    it('should write file atomically', () => {
      const filePath = path.join(tempDir, 'test.txt');
      atomicWrite(filePath, 'content', { root: tempDir });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('content');
    });

    it('should create parent directories', () => {
      const filePath = path.join(tempDir, 'a', 'b', 'test.txt');
      atomicWrite(filePath, 'content', { root: tempDir });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('content');
    });

    it('should create backup when requested', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'original');
      const { backupPath } = atomicWrite(filePath, 'new content', { root: tempDir, backup: true });
      expect(backupPath).toBe(`${filePath}.bak`);
      expect(fs.readFileSync(backupPath!, 'utf-8')).toBe('original');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
    });

    it('should throw on path traversal', () => {
      const filePath = path.join(tempDir, '..', 'outside.txt');
      expect(() => atomicWrite(filePath, 'content', { root: tempDir })).toThrow(
        /Path traversal detected/
      );
    });
  });

  describe('createBackup', () => {
    it('should create .bak file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'original');
      const backupPath = createBackup(filePath);
      expect(backupPath).toBe(`${filePath}.bak`);
      expect(fs.readFileSync(backupPath!, 'utf-8')).toBe('original');
    });

    it('should return null for non-existing file', () => {
      const backupPath = createBackup(path.join(tempDir, 'nonexistent.txt'));
      expect(backupPath).toBeNull();
    });
  });

  describe('findUpward', () => {
    it('should find file in current directory', () => {
      const filePath = path.join(tempDir, 'target.txt');
      fs.writeFileSync(filePath, '');
      const result = findUpward(tempDir, 'target.txt');
      expect(result).toBe(filePath);
    });

    it('should find file in parent directory', () => {
      const nestedDir = path.join(tempDir, 'a', 'b', 'c');
      fs.mkdirSync(nestedDir, { recursive: true });
      const filePath = path.join(tempDir, 'target.txt');
      fs.writeFileSync(filePath, '');
      const result = findUpward(nestedDir, 'target.txt');
      expect(result).toBe(filePath);
    });

    it('should return null when file not found', () => {
      const result = findUpward(tempDir, 'nonexistent.txt');
      expect(result).toBeNull();
    });
  });
});
