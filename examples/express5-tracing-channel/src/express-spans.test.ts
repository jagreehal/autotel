import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';
import { init, shutdown } from 'autotel';
import { createApp } from './app.ts';
import { instrumentExpress } from './express-spans.ts';

const exporter = new InMemorySpanExporter();
let server: Server;
let base: string;
let stop: () => void;

beforeAll(async () => {
  init({
    service: 'express5-test',
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  stop = instrumentExpress();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  // SAFETY: listen(0) on TCP always yields an AddressInfo.
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  stop();
  server.close();
  await shutdown();
});

const spans = () => exporter.getFinishedSpans();
const named = (name: string) => spans().find((s) => s.name === name);

describe('express.router.request spans', () => {
  it('nest each request under its own SERVER span, even when requests overlap', async () => {
    await Promise.all([fetch(`${base}/users/42`), fetch(`${base}/orders/7`)]);
    await expect.poll(() => spans().filter((s) => s.kind === 1).length).toBe(2);

    const users = named('GET /users/:id');
    const getUser = named('getUser');
    const findUser = named('db.users.find');
    expect(users?.attributes['http.response.status_code']).toBe(200);
    expect(getUser?.parentSpanContext?.spanId).toBe(
      users?.spanContext().spanId,
    );
    expect(findUser?.parentSpanContext?.spanId).toBe(
      getUser?.spanContext().spanId,
    );
    expect(named('validateId')?.attributes['express.param']).toBe('id');

    const orders = named('GET /orders/:id');
    expect(orders?.spanContext().traceId).not.toBe(
      users?.spanContext().traceId,
    );
    expect(named('db.orders.find')?.parentSpanContext?.spanId).toBe(
      named('loadOrder')?.spanContext().spanId,
    );
  });

  it('marks the handler that failed, and the request, as errors', async () => {
    exporter.reset();
    await fetch(`${base}/orders/7`);
    await expect.poll(() => named('GET /orders/:id')).toBeDefined();

    expect(named('loadOrder')?.status).toMatchObject({
      code: 2,
      message: 'connection refused',
    });
    expect(named('authenticate')?.status.code).toBe(0);
    expect(
      named('GET /orders/:id')?.attributes['http.response.status_code'],
    ).toBe(500);
    expect(named('errorHandler')?.attributes['express.type']).toBe(
      'error_handler',
    );
  });
});
