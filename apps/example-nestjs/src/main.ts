/**
 * NestJS + autotel example
 *
 * Uses autoInstrumentations: ['http', 'nestjs-core'] for HTTP/Nest tracing.
 * Run: pnpm start
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`  - http://localhost:${port}/health`);
  console.log(`  - http://localhost:${port}/users/user-123`);
  console.log(`  - http://localhost:${port}/users/user-123/orders`);
  console.log(`  - http://localhost:${port}/error`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
