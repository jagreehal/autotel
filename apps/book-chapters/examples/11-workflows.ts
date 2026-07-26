import { init, flush, shutdown } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { traceWorkflow, traceStep } from 'autotel/workflow';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 11: Workflows & Sagas ===\n');

  init({
    service: 'book-11',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Each step is a plain async function wrapped by traceStep(config)(fn).
  // Steps auto-attach to the surrounding workflow via AsyncLocalStorage.
  const validateInventory = traceStep({ name: 'validate-inventory' })(async (
    orderId: string,
  ) => {
    console.log(`  Step 1: Inventory validated for ${orderId}`);
    return 'available';
  });

  const processPayment = traceStep({ name: 'process-payment' })(async (
    orderId: string,
  ) => {
    console.log(`  Step 2: Payment processed for ${orderId}`);
    return 'completed';
  });

  const sendConfirmation = traceStep({ name: 'send-confirmation' })(async (
    orderId: string,
  ) => {
    console.log(`  Step 3: Confirmation sent for ${orderId}`);
    return 'email';
  });

  // traceWorkflow(config)(factory) wraps the whole flow in a workflow span
  // and threads workflow.id / workflow.name onto every step span.
  const processOrder = traceWorkflow({
    name: 'order-processing',
    workflowId: (orderId: string) => orderId,
  })((ctx) => async (orderId: string) => {
    ctx.setAttribute('order.id', orderId);
    const inventory = await validateInventory(orderId);
    const payment = await processPayment(orderId);
    const notification = await sendConfirmation(orderId);
    return { orderId, inventory, payment, notification };
  });

  const result = await processOrder('ord_456');
  console.log('\n  Workflow result:', result);

  await flush();
  const spans = exporter.getFinishedSpans();
  const names = spans.map((span) => span.name);
  const expected = [
    'step.validate-inventory',
    'step.process-payment',
    'step.send-confirmation',
    'workflow.order-processing',
  ];
  for (const name of expected) {
    if (!names.includes(name)) {
      throw new Error(`Missing expected workflow span: ${name}`);
    }
  }
  if (result.inventory !== 'available' || result.payment !== 'completed') {
    throw new Error('Step results were not returned through the workflow');
  }
  console.log(`\n  Spans created: ${spans.length}`);
  for (const s of spans) console.log(`    - "${s.name}"`);

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
