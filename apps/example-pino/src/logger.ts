// Created in its own module, after telemetry.ts has run init().
import pino from 'pino';

export const logger = pino({
  name: 'example-pino',
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});
