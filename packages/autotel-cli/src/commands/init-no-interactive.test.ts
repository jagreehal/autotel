import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AutotelError } from '../lib/errors';
import type { InitOptions } from '../types/index';

const { promptBackendMock } = vi.hoisted(() => ({
  promptBackendMock: vi.fn(async () => 'local'),
}));

vi.mock('../ui/prompts', async () => {
  const actual =
    await vi.importActual<typeof import('../ui/prompts')>('../ui/prompts');
  return {
    ...actual,
    promptBackend: promptBackendMock,
  };
});

import { runInit } from './init';

describe('init no-plan-source behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'autotel-init-no-interactive-test-'),
    );
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2),
      'utf8',
    );
    promptBackendMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails fast and does not prompt when --no-detect is set and no plan source exists', async () => {
    const options: InitOptions = {
      cwd: tempDir,
      dryRun: false,
      noInstall: true,
      printInstallCmd: false,
      verbose: false,
      quiet: true,
      workspaceRoot: false,
      yes: false,
      force: false,
      noDetect: true,
      detectOnly: false,
      scanEnv: false,
      json: false,
      noSecrets: false,
      noInteractive: false,
    };

    let thrown: unknown;
    try {
      await runInit(options);
    } catch (error) {
      thrown = error;
    }

    expect(promptBackendMock).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(AutotelError);
    expect((thrown as AutotelError).code).toBe('AUTOTEL_E_INVALID_FLAG');
  });

  it('also fails fast in no-interactive mode for the same missing source case', async () => {
    const options: InitOptions = {
      cwd: tempDir,
      dryRun: false,
      noInstall: true,
      printInstallCmd: false,
      verbose: false,
      quiet: true,
      workspaceRoot: false,
      yes: false,
      force: false,
      noDetect: true,
      detectOnly: false,
      scanEnv: false,
      json: false,
      noSecrets: false,
      noInteractive: true,
    };

    await expect(runInit(options)).rejects.toBeInstanceOf(AutotelError);
    expect(promptBackendMock).not.toHaveBeenCalled();
  });

  it('lists every detected logger and library in the autoInstrumentations allowlist', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: {
          express: '^5.0.0',
          winston: '^3.0.0',
          next: '^15.0.0',
          '@aws-sdk/client-s3': '^3.0.0',
        },
      }),
      'utf8',
    );

    await runInit({
      cwd: tempDir,
      dryRun: false,
      noInstall: true,
      printInstallCmd: false,
      verbose: false,
      quiet: true,
      workspaceRoot: false,
      yes: true,
      force: false,
      noDetect: false,
      detectOnly: false,
      scanEnv: false,
      json: false,
      noSecrets: false,
      noInteractive: true,
    });

    const file = fs
      .readdirSync(tempDir, { recursive: true })
      .map(String)
      .find((f) => /instrumentation\.(m?[jt]s)$/.test(f));
    const out = fs.readFileSync(path.join(tempDir, file!), 'utf8');
    expect(out).toContain(
      "autoInstrumentations: ['http', 'winston', 'express', 'aws-sdk'],",
    );
    expect(out).not.toContain('logger:');
  });

  it.each(['next', 'fastify'])(
    'gives a %s-only project http request spans',
    async (framework) => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { [framework]: '^1.0.0' },
        }),
        'utf8',
      );

      await runInit({
        cwd: tempDir,
        dryRun: false,
        noInstall: true,
        printInstallCmd: false,
        verbose: false,
        quiet: true,
        workspaceRoot: false,
        yes: true,
        force: false,
        noDetect: false,
        detectOnly: false,
        scanEnv: false,
        json: false,
        noSecrets: false,
        noInteractive: true,
      });

      const file = fs
        .readdirSync(tempDir, { recursive: true })
        .map(String)
        .find((f) => /instrumentation\.(m?[jt]s)$/.test(f));
      const out = fs.readFileSync(path.join(tempDir, file!), 'utf8');
      expect(out).toContain("autoInstrumentations: ['http'],");
    },
  );
});
