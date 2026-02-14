#!/usr/bin/env node
/**
 * Run Playwright tests and write result to test-results.txt (for CI/automation).
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, 'test-results.txt');

const child = spawn(
  'npx',
  ['playwright', 'test', '--reporter=line'],
  {
    cwd: __dirname,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

let stdout = '';
let stderr = '';
child.stdout?.on('data', (d) => { stdout += d; process.stdout.write(d); });
child.stderr?.on('data', (d) => { stderr += d; process.stderr.write(d); });

child.on('close', (code, signal) => {
  const result = [
    `=== RUN ${new Date().toISOString()} ===`,
    '=== STDOUT ===',
    stdout,
    '=== STDERR ===',
    stderr,
    '=== EXIT ===',
    `code=${code} signal=${signal}`,
  ].join('\n');
  writeFileSync(outPath, result, 'utf8');
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  writeFileSync(outPath, `Spawn error: ${err.message}`, 'utf8');
  process.exit(1);
});
