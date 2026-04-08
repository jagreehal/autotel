import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { DevtoolsServer } from '../../server';
import { attachDevtoolsRoutes } from '../../http';

export interface TestServerDeps {
  createHttpServer: () => Server;
}

export interface TestServer {
  server: DevtoolsServer;
  httpServer: Server;
  port: number;
  close: () => Promise<void>;
}

export function createTestServer(
  deps: TestServerDeps = { createHttpServer: () => createServer() },
): Promise<TestServer> {
  return new Promise((resolve) => {
    const httpServer = deps.createHttpServer();
    const wsServer = new DevtoolsServer({ server: httpServer });
    attachDevtoolsRoutes(httpServer, wsServer);

    httpServer.listen(0, () => {
      const port = (httpServer.address() as { port: number }).port;
      resolve({
        server: wsServer,
        httpServer,
        port,
        close: async () => {
          await wsServer.close();
        },
      });
    });
  });
}

export interface TestWebSocketDeps {
  WebSocket: typeof WebSocket;
}

export interface TestWebSocket {
  ws: WebSocket;
  messages: unknown[];
  send: (data: unknown) => void;
  close: () => void;
}

export function createTestWebSocket(
  port: number,
  deps: TestWebSocketDeps = { WebSocket },
): Promise<TestWebSocket> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const ws = new deps.WebSocket(`ws://localhost:${port}/ws`);

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        send: (data) => ws.send(JSON.stringify(data)),
        close: () => ws.close(),
      });
    });
  });
}

export type FetchDeps = {
  fetch: typeof fetch;
};

export async function sendOtlpTraces(
  port: number,
  payload: unknown,
  deps: FetchDeps = { fetch },
): Promise<Response> {
  return deps.fetch(`http://localhost:${port}/v1/traces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function sendOtlpLogs(
  port: number,
  payload: unknown,
  deps: FetchDeps = { fetch },
): Promise<Response> {
  return deps.fetch(`http://localhost:${port}/v1/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function sendOtlpMetrics(
  port: number,
  payload: unknown,
  deps: FetchDeps = { fetch },
): Promise<Response> {
  return deps.fetch(`http://localhost:${port}/v1/metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
