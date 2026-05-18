import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInit } from './init';
import type { InitOptions } from '../types/index';

describe('init merge behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-init-merge-test-'));
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2),
      'utf8'
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rewrites CLI-owned instrumentation when preset config changes but import source is unchanged', async () => {
    const instrumentationPath = path.join(tempDir, 'instrumentation.mjs');
    fs.writeFileSync(
      instrumentationPath,
      `/**\n * autotel instrumentation - managed by autotel-cli\n */\n\nimport 'autotel/register';\nimport { init } from 'autotel';\nimport { createDatadogConfig } from 'autotel-backends/datadog';\n\ninit({\n  serviceName: process.env.OTEL_SERVICE_NAME ?? 'app',\n  ...createDatadogConfig({\n    apiKey: process.env.DATADOG_API_KEY,\n    site: process.env.DATADOG_SITE,\n  }),\n});\n`,
      'utf8'
    );

    const planPath = path.join(tempDir, 'plan.json');
    fs.writeFileSync(
      planPath,
      JSON.stringify(
        {
          v: 1,
          presets: ['datadog-agent'],
          packagesToInstall: { prod: ['autotel', 'autotel-backends'], dev: [] },
          filesToWrite: [],
          envVars: [],
          nextSteps: [],
        },
        null,
        2
      ),
      'utf8'
    );

    const options: InitOptions = {
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
      plan: planPath,
      scanEnv: false,
      json: false,
      noSecrets: false,
      noInteractive: true,
    };

    await runInit(options);

    const updated = fs.readFileSync(instrumentationPath, 'utf8');
    expect(updated).toContain('createDatadogAgentConfig');
    expect(updated).not.toContain('createDatadogConfig');
  });
});
