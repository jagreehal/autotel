// "It feels faster" does not survive code review. Put the deployment on the
// span, run the same operation before and after, and compare the two
// populations instead of arguing about them.

import { withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';

const collector = createTraceCollector();
const recordRun = withTracing({ name: 'checkout.performance' })(
  (ctx) => (deployment: string, durationMs: number, dbRows: number) => {
    ctx.setAttributes({
      'deployment.id': deployment,
      'checkout.duration_ms': durationMs,
      'db.rows_returned': dbRows,
    });
  },
);

recordRun('before', 900, 1_200);
recordRun('before', 860, 1_100);
recordRun('after', 410, 40);
recordRun('after', 390, 38);

function mean(deployment: string, field: string): number {
  const values = collector
    .getSpansByAttributes({ 'deployment.id': deployment })
    .map((item) => Number(item.attributes[field]));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const before = mean('before', 'checkout.duration_ms');
const after = mean('after', 'checkout.duration_ms');
if (after >= before) throw new Error('The change did not reduce latency');

// Latency says the change worked. The row count says why, which is the part
// that survives review.
const rowsBefore = mean('before', 'db.rows_returned');
const rowsAfter = mean('after', 'db.rows_returned');

console.log('OE 20: same operation, two deployments, one query');
console.log(`  mean latency ${before} ms before, ${after} ms after`);
console.log(
  `  the cause is on the same span: ${rowsBefore} rows read before, ${rowsAfter} after`,
);
