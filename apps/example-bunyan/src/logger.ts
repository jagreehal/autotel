// Created in its own module, after telemetry.ts has run init().
import bunyan from 'bunyan';

export const logger = bunyan.createLogger({
  name: 'example-bunyan',
  level: 'info',
  streams: [{ stream: process.stdout }],
});
