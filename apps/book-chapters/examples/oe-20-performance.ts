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

function mean(deployment: string): number {
  const values = collector
    .getSpansByAttributes({ 'deployment.id': deployment })
    .map((item) => Number(item.attributes['checkout.duration_ms']));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const before = mean('before');
const after = mean('after');
if (after >= before) throw new Error('The change did not reduce latency');

console.log('OE 20: compared the same operation across deployments');
console.log(`  mean latency: ${before} ms before, ${after} ms after`);
