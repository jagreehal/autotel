// Created in its own module, after telemetry.ts has run init().
import pino from 'pino';

export const log = pino({ name: 'example-sentry' });
