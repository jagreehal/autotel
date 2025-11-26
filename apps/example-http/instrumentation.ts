/**
 * OpenTelemetry instrumentation setup
 *
 * This file must be loaded BEFORE the application code via --import flag
 * to enable ESM auto-instrumentation (http, express, pino, etc.)
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
  name: 'example-http-server',
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

init({
  service: 'example-http-server',
  debug: true,
  logger,
  integrations: ['express', 'http', 'pino'],
});
