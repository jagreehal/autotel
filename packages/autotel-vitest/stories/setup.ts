import { init } from 'autotel';
import { SimpleSpanProcessor } from 'autotel/processors';
import { otelTestCollector } from 'autotel-vitest';

// init() per worker, not in globalSetup: spans are created in the worker that
// runs the test, and worker module state is not shared with the main process
// where globalSetup runs.
//
// otelTestCollector is the collector the fixture drains onto task.meta after
// each test, which is where the executable-stories reporter reads spans from.
// On OpenTelemetry SDK 2.x a span processor can only be registered here, at
// provider construction — there is no addSpanProcessor to call later.
init({
  service: 'autotel-stories',
  spanProcessors: [new SimpleSpanProcessor(otelTestCollector)],
});
