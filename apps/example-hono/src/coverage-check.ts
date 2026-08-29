/**
 * What am I not seeing?
 *
 * A telemetry backend can only describe the spans it received, so it can never
 * name a handler that has emitted nothing. Answering that needs the source as
 * well: `autotel map` walks the project and writes `autotel.map.json`, and the
 * devtools Coverage view joins that record against what has arrived.
 *
 * This script drives the app in-process, calls two of its routes, and asserts
 * that Coverage reports the routes it called as seen and the ones it did not
 * as dark. Run `pnpm map` first, or the check has no map to join against.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { createDevtools } from 'autotel-devtools';
import { init, flush } from 'autotel';

const devtools = createDevtools({ port: 4319, sourceRoot: process.cwd() });
await devtools.ready;

init({
  service: 'example-hono-service',
  spanExporters: [devtools.exporter],
});

// After init, so the middleware traces against the configured provider.
const { app } = await import('./app');

const called = ['/users/user-123', '/users/user-123/orders'];
for (const path of called) await app.request(path);

await flush();

const response = await fetch('http://127.0.0.1:4319/api/coverage');
assert.equal(
  response.status,
  200,
  'no autotel.map.json — run `pnpm map` first (a missing map is a 404, not an empty report)',
);

interface CoverageEntry {
  method: string | null;
  path: string;
  seen: boolean;
  spanCount: number;
}
// SAFETY: the 200 above came from `GET /api/coverage`, whose only success
// body is a CoverageReport, so the shape is the route's contract.
const report = (await response.json()) as {
  entries: CoverageEntry[];
  seenCount: number;
  total: number;
};

console.log(`\nCalled: ${called.join(', ')}\n`);
console.log(
  `Coverage: ${report.seenCount} of ${report.total} entry points seen\n`,
);
for (const entry of report.entries) {
  const label = `${entry.method ?? 'ANY'} ${entry.path}`;
  console.log(
    `  ${entry.seen ? 'seen' : 'DARK'}  ${label.padEnd(28)} ${entry.spanCount} spans`,
  );
}

const find = (path: string) => report.entries.find((e) => e.path === path);

assert.ok(find('/users/:userId')?.seen, 'a route we called should be seen');
assert.ok(
  find('/users/:userId/orders')?.seen,
  'a route we called should be seen',
);
assert.equal(
  find('/health')?.seen,
  false,
  '/health was never called, so Coverage should still report it dark',
);
assert.equal(
  find('/error')?.seen,
  false,
  '/error was never called, so Coverage should still report it dark',
);

// A project that has never been mapped gets a 404 with instructions, not an
// empty report: zero routes and zero unseen routes look the same in a count,
// and "0 of 0" would read as a clean bill of health.
const unmapped = createDevtools({ port: 4320, sourceRoot: tmpdir() });
await unmapped.ready;
const missing = await fetch('http://127.0.0.1:4320/api/coverage');
assert.equal(
  missing.status,
  404,
  'a missing map should be a 404, not an empty report',
);
await unmapped.close();

console.log(
  '\nAssertions passed: the routes we exercised are seen, the rest are still dark,',
);
console.log(
  'and a project with no map gets a 404 rather than a false all-clear.',
);

await devtools.close();
