/**
 * OpenTelemetry instrumentation setup
 *
 * This file must be loaded BEFORE the application code via --import flag
 * to enable ESM auto-instrumentation.
 *
 * Usage: tsx --import ./instrumentation.ts src/index.ts
 *
 * The autotel/register import MUST be first - it registers the ESM loader
 * hooks before any other modules are loaded.
 */

// Register ESM hooks first (MUST be before any other imports!)
import 'autotel/register';

import { init } from 'autotel';
import pino from 'pino';

const logger = pino({
  name: 'example-awaitly',
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

// Registers the tracer, meter and context manager awaitly reads. With no
// endpoint, `debug: 'pretty'` prints each trace as a tree.
init({
  service: 'example-awaitly',
  debug: 'pretty',
  logger,
});
