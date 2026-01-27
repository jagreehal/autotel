import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectPackageManager,
  getInstallCommand,
  detectWorkspaceRoot,
} from './package-manager.js';

describe('package-manager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectPackageManager', () => {
    it('should detect npm from package-lock.json', () => {
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{}');
      const result = detectPackageManager(tempDir);
      expect(result.packageManager).toBe('npm');
      expect(result.lockfilePath).toContain('package-lock.json');
    });

    it('should detect yarn from yarn.lock', () => {
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');
      const result = detectPackageManager(tempDir);
      expect(result.packageManager).toBe('yarn');
      expect(result.lockfilePath).toContain('yarn.lock');
    });

    it('should detect pnpm from pnpm-lock.yaml', () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');
      const result = detectPackageManager(tempDir);
      expect(result.packageManager).toBe('pnpm');
      expect(result.lockfilePath).toContain('pnpm-lock.yaml');
    });

    it('should detect bun from bun.lockb', () => {
      fs.writeFileSync(path.join(tempDir, 'bun.lockb'), '');
      const result = detectPackageManager(tempDir);
      expect(result.packageManager).toBe('bun');
      expect(result.lockfilePath).toContain('bun.lockb');
    });

    it('should default to npm when no lockfile found', () => {
      const result = detectPackageManager(tempDir);
      expect(result.packageManager).toBe('npm');
      expect(result.lockfilePath).toBeNull();
    });

    it('should find closest lockfile in nested directories', () => {
      // Create nested structure with lockfile at parent level
      const nestedDir = path.join(tempDir, 'packages', 'my-app');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');

      const result = detectPackageManager(nestedDir);
      expect(result.packageManager).toBe('pnpm');
    });

    it('should prefer closer lockfile over parent lockfile', () => {
      const nestedDir = path.join(tempDir, 'packages', 'my-app');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');
      fs.writeFileSync(path.join(nestedDir, 'yarn.lock'), '');

      const result = detectPackageManager(nestedDir);
      expect(result.packageManager).toBe('yarn');
    });
  });

  describe('getInstallCommand', () => {
    it('should generate npm install command', () => {
      const cmd = getInstallCommand('npm', ['autotel', '@opentelemetry/sdk-trace-base']);
      expect(cmd).toBe('npm install autotel @opentelemetry/sdk-trace-base');
    });

    it('should generate npm install --save-dev command', () => {
      const cmd = getInstallCommand('npm', ['typescript'], { dev: true });
      expect(cmd).toBe('npm install --save-dev typescript');
    });

    it('should generate pnpm add command', () => {
      const cmd = getInstallCommand('pnpm', ['autotel']);
      expect(cmd).toBe('pnpm add autotel');
    });

    it('should generate pnpm add -D command', () => {
      const cmd = getInstallCommand('pnpm', ['typescript'], { dev: true });
      expect(cmd).toBe('pnpm add -D typescript');
    });

    it('should generate pnpm add -w command for workspace root', () => {
      const cmd = getInstallCommand('pnpm', ['autotel'], { workspaceRoot: true });
      expect(cmd).toBe('pnpm add -w autotel');
    });

    it('should generate yarn add command', () => {
      const cmd = getInstallCommand('yarn', ['autotel']);
      expect(cmd).toBe('yarn add autotel');
    });

    it('should generate yarn add -D command', () => {
      const cmd = getInstallCommand('yarn', ['typescript'], { dev: true });
      expect(cmd).toBe('yarn add -D typescript');
    });

    it('should generate bun add command', () => {
      const cmd = getInstallCommand('bun', ['autotel']);
      expect(cmd).toBe('bun add autotel');
    });

    it('should generate bun add -d command', () => {
      const cmd = getInstallCommand('bun', ['typescript'], { dev: true });
      expect(cmd).toBe('bun add -d typescript');
    });
  });

  describe('detectWorkspaceRoot', () => {
    it('should detect pnpm workspace from pnpm-workspace.yaml', () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*');
      const result = detectWorkspaceRoot(tempDir);
      expect(result.workspaceRoot).toBe(tempDir);
      expect(result.workspaceType).toBe('pnpm');
    });

    it('should detect lerna workspace from lerna.json', () => {
      fs.writeFileSync(path.join(tempDir, 'lerna.json'), '{}');
      const result = detectWorkspaceRoot(tempDir);
      expect(result.workspaceRoot).toBe(tempDir);
      expect(result.workspaceType).toBe('lerna');
    });

    it('should detect npm/yarn workspace from package.json workspaces field', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      const result = detectWorkspaceRoot(tempDir);
      expect(result.workspaceRoot).toBe(tempDir);
      expect(result.workspaceType).toBe('npm');
    });

    it('should detect yarn workspace when yarn.lock present', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');
      const result = detectWorkspaceRoot(tempDir);
      expect(result.workspaceRoot).toBe(tempDir);
      expect(result.workspaceType).toBe('yarn');
    });

    it('should return null when no workspace root found', () => {
      const result = detectWorkspaceRoot(tempDir);
      expect(result.workspaceRoot).toBeNull();
      expect(result.workspaceType).toBeNull();
    });
  });
});
