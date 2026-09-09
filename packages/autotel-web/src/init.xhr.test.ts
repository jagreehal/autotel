/**
 * XHR instrumentation, against a real XMLHttpRequest and a real server.
 *
 * These run under jsdom rather than the hand-mocked window the other tests use,
 * because the bug they were written for only exists in a faithful XHR: `open()`
 * fires the OPENED `readystatechange` before it returns, so the handler this
 * module used to assign after calling `open()` never saw that state, and no
 * traceparent was ever injected. A mock that fires OPENED late would have
 * called it green. Injection now happens in `send()`.
 */

// @vitest-environment jsdom

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./span-exporter', () => ({
  configureExporter: vi.fn(),
  setRawFetch: vi.fn(),
  recordSpan: vi.fn(),
  recordEvent: vi.fn(),
  flushSpans: vi.fn(),
  isConfigured: vi.fn(() => true),
  resetForTesting: vi.fn(),
}));

import { init, resetForTesting } from './init';

const MANUAL_TRACEPARENT =
  '00-11111111111111111111111111111111-1111111111111111-01';

let server: Server;
let origin: string;
let received: Array<Record<string, string | undefined>>;

beforeEach(async () => {
  received = [];
  server = createServer((request, response) => {
    // jsdom's page origin differs from the server's, so a header like
    // traceparent needs the preflight answered before it is sent at all.
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors);
      response.end();
      return;
    }
    received.push({
      traceparent: request.headers.traceparent as string | undefined,
      authorization: request.headers.authorization as string | undefined,
    });
    response.writeHead(200, cors);
    response.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  origin = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  resetForTesting();
  server.close();
});

/** Send on an existing XHR instance and resolve once the server has answered. */
function sendOn(
  xhr: XMLHttpRequest,
  path: string,
  before?: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    xhr.open('GET', `${origin}${path}`);
    before?.(xhr);
    xhr.onload = () => resolve();
    xhr.onerror = () => reject(new Error('xhr failed'));
    xhr.send();
  });
}

/** Send one XHR and resolve once the server has answered. */
function send(
  path: string,
  before?: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${origin}${path}`);
    before?.(xhr);
    xhr.addEventListener('load', () => resolve());
    xhr.addEventListener('error', () => reject(new Error('xhr failed')));
    xhr.send();
  });
}

describe('XHR traceparent injection', () => {
  it('sends nothing cross-origin without propagateTo', async () => {
    // The server here allows the header, but most do not: an unexpected
    // `traceparent` makes the browser preflight, and a server that does not
    // list it in `Access-Control-Allow-Headers` fails the request outright.
    // So the default has to be same-origin, which the test server is not.
    init({ service: 'demo', instrumentFetch: false, instrumentXHR: true });

    await send('/api');

    expect(received[0]?.traceparent).toBeUndefined();
  });

  it('reaches the server', async () => {
    init({
      service: 'demo',
      instrumentFetch: false,
      instrumentXHR: true,
      // jsdom's page origin is not the test server's, and cross-origin
      // propagation is opt-in - which is the whole point of the preflight the
      // server answers below.
      propagateTo: [origin],
    });

    await send('/api');

    expect(received[0]?.traceparent).toMatch(
      /^00-[\da-f]{32}-[\da-f]{16}-0[01]$/,
    );
  });

  it('leaves a traceparent the caller set with setRequestHeader', async () => {
    init({
      service: 'demo',
      instrumentFetch: false,
      instrumentXHR: true,
      propagateTo: [origin],
    });

    await send('/api', (xhr) => {
      xhr.setRequestHeader('traceparent', MANUAL_TRACEPARENT);
    });

    expect(received[0]?.traceparent).toBe(MANUAL_TRACEPARENT);
  });

  it('does not disturb an onreadystatechange handler the app assigns', async () => {
    init({
      service: 'demo',
      instrumentFetch: false,
      instrumentXHR: true,
      propagateTo: [origin],
    });
    const states: number[] = [];

    await send('/api', (xhr) => {
      xhr.onreadystatechange = () => states.push(xhr.readyState);
    });

    // The app's handler still runs, and injection happened anyway.
    expect(states).toContain(4);
    expect(received[0]?.traceparent).toBeTruthy();
  });

  it('injects on every request when one instance is reused', async () => {
    init({
      service: 'demo',
      instrumentFetch: false,
      instrumentXHR: true,
      propagateTo: [origin],
    });
    const xhr = new XMLHttpRequest();

    await sendOn(xhr, '/one');
    await sendOn(xhr, '/two');

    // open() empties the request headers, so the "already has one" markers are
    // cleared with them. They used to survive, and every request after the
    // first went out bare.
    expect(received[0]?.traceparent).toBeTruthy();
    expect(received[1]?.traceparent).toBeTruthy();
    expect(received[1]?.traceparent).not.toBe(received[0]?.traceparent);
  });

  it('still respects a manual traceparent on a reused instance', async () => {
    init({
      service: 'demo',
      instrumentFetch: false,
      instrumentXHR: true,
      propagateTo: [origin],
    });
    const xhr = new XMLHttpRequest();

    await sendOn(xhr, '/one');
    await sendOn(xhr, '/two', (x) => {
      x.setRequestHeader('traceparent', MANUAL_TRACEPARENT);
    });

    expect(received[1]?.traceparent).toBe(MANUAL_TRACEPARENT);
  });

  it('leaves a traceparent an OPENED handler sets during open()', async () => {
    init({
      service: 'demo',
      instrumentFetch: false,
      instrumentXHR: true,
      propagateTo: [origin],
    });
    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.OPENED) {
        xhr.setRequestHeader('traceparent', MANUAL_TRACEPARENT);
      }
    };

    await sendOn(xhr, '/one');

    // open() fires OPENED before it returns, so this header is set while
    // open() is still on the stack. Resetting the markers after that call
    // discarded the record of it, and send() appended a second value:
    // "00-1111..., 00-c4ad..." — a header no backend can parse.
    expect(received[0]?.traceparent).toBe(MANUAL_TRACEPARENT);
  });

  it('injects nothing when instrumentXHR is off', async () => {
    init({ service: 'demo', instrumentFetch: false, instrumentXHR: false });

    await send('/api');

    expect(received[0]?.traceparent).toBeUndefined();
  });
});
