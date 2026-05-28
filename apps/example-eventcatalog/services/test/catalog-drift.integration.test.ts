// Programmatic version of `pnpm catalog:drift`. Locks in the example app's
// "steady state": the committed snapshot and the committed catalog must
// agree, so `autotel-eventcatalog drift` reports nothing. If a service stops
// emitting an event, or a catalog file rots, this test fails before CI sees
// the broken `pnpm catalog:drift` script.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diffCatalogAgainstSnapshot,
  loadSnapshot,
  readCatalogState,
  evaluatePolicy,
  countDriftReport,
} from 'autotel-eventcatalog';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SNAPSHOT_PATH = join(HERE, 'snapshot.json');
const CATALOG_PATH = join(HERE, '..', '..', 'catalog');

describe('example-eventcatalog catalog drift', () => {
  it('snapshot and catalog agree (the demo steady state)', async () => {
    const snapshot = await loadSnapshot(SNAPSHOT_PATH);
    const catalog = await readCatalogState(CATALOG_PATH);
    const report = diffCatalogAgainstSnapshot(snapshot, catalog);

    const result = evaluatePolicy({ mode: 'all', report });
    const counts = countDriftReport(report);

    if (result.shouldFail) {
      const undocumented = report.events.observedButUndocumented;
      const unseen = report.events.documentedButUnseen;
      const lines = [
        'Catalog drift detected:',
        `  reason: ${result.reason}`,
        `  counts: ${JSON.stringify(counts)}`,
      ];

      if (unseen.length > 0) {
        lines.push(
          '',
          `Documented but never observed: ${unseen.join(', ')}.`,
          'These events are declared in the catalog but no test exercises them.',
          'Extend services/src/build-snapshot.ts so the snapshot run emits them,',
          'then `pnpm services:snapshot` to refresh services/test/snapshot.json.',
        );
      }
      if (undocumented.length > 0) {
        lines.push(
          '',
          `Observed but undocumented: ${undocumented.join(', ')}.`,
          'These events fire at runtime but the catalog does not describe them.',
          'Either add catalog pages (apps/example-eventcatalog/catalog/events/...)',
          'or `pnpm autotel-eventcatalog generate` to scaffold them.',
        );
      }
      throw new Error(lines.join('\n'));
    }

    expect(result.shouldFail).toBe(false);
    expect(result.reason).toMatch(/No drift detected/);
    expect(counts.total).toBe(0);
  });
});
