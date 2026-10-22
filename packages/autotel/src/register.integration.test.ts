import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const register = fileURLToPath(new URL('register.ts', import.meta.url));
// The copy of import-in-the-middle the instrumentations call `Hook()` from.
const otelIitm = createRequire(
  createRequire(import.meta.url).resolve('@opentelemetry/instrumentation'),
).resolve('import-in-the-middle');

const require = createRequire(import.meta.url);
const autoRequire = createRequire(
  require.resolve('@opentelemetry/auto-instrumentations-node'),
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-register-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function write(files: Record<string, string>): void {
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
}

function run(entry: string): string {
  return execFileSync(
    process.execPath,
    ['--import', register, '--import', './hook.mjs', entry],
    { cwd: root, encoding: 'utf8' },
  ).trim();
}

write({
  'hook.mjs': `
    import { createRequire } from 'node:module';
    const { Hook } = createRequire(${JSON.stringify(otelIitm)})('import-in-the-middle');
    Hook(['fakepkg'], (exported) => { exported.hello = () => 'patched'; return exported; });
  `,
  'node_modules/fakepkg/package.json': JSON.stringify({
    name: 'fakepkg',
    type: 'module',
    exports: './index.mjs',
  }),
  'node_modules/fakepkg/index.mjs': `export const hello = () => 'real';`,
});

describe('autotel/register', () => {
  it('still lets instrumentations patch packages', () => {
    write({
      'package.mjs': `import { hello } from 'fakepkg'; console.log(hello());`,
    });
    expect(run('package.mjs')).toBe('patched');
  });

  it('exports logs from pino loaded through an ESM import', () => {
    fs.symlinkSync(
      path.dirname(require.resolve('pino')),
      path.join(root, 'node_modules/pino'),
      'dir',
    );
    write({
      'pino-setup.mjs': `
        import { createRequire } from 'node:module';
        const require = createRequire(${JSON.stringify(import.meta.url)});
        const { LoggerProvider, SimpleLogRecordProcessor, InMemoryLogRecordExporter } = require('@opentelemetry/sdk-logs');
        const { logs } = require('@opentelemetry/api-logs');
        const { PinoInstrumentation } = require(${JSON.stringify(autoRequire.resolve('@opentelemetry/instrumentation-pino'))});
        const exporter = new InMemoryLogRecordExporter();
        const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
        logs.setGlobalLoggerProvider(provider);
        new PinoInstrumentation();
        globalThis.verifyLogs = async () => {
          await provider.forceFlush();
          console.log(JSON.stringify(exporter.getFinishedLogRecords().map(record => record.body)));
          await provider.shutdown();
        };
      `,
      'pino-entry.mjs': `
        import pino from 'pino';
        pino({ enabled: true }, { write() {} }).info('esm log exported');
        await globalThis.verifyLogs();
      `,
    });
    const output = execFileSync(
      process.execPath,
      ['--import', register, '--import', './pino-setup.mjs', 'pino-entry.mjs'],
      { cwd: root, encoding: 'utf8' },
    ).trim();
    expect(JSON.parse(output)).toEqual(['esm log exported']);
  });

  /* A wrapped barrel gets its own uninitialised copies of the exports, so a
     module reading one through the barrel mid-cycle would hit a TDZ that plain
     Node does not. App code runs unwrapped, as written. */
  it('leaves app code alone, so a barrel cycle evaluates as it does without the hook', () => {
    write({
      'providers/index.mjs': `
        export * from './currency-cloud.mjs';
        export * from './registry.mjs';
      `,
      'providers/currency-cloud.mjs': `export const currencyCloudApiProvider = { name: 'cc' };`,
      'providers/registry.mjs': `
        import { currencyCloudApiProvider } from './index.mjs';
        export const registry = { cc: currencyCloudApiProvider };
      `,
      'cycle.mjs': `import { registry } from './providers/index.mjs'; console.log(registry.cc.name);`,
    });
    expect(run('cycle.mjs')).toBe('cc');
  });
});
