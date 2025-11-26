/**
 * MockWebhookServer - In-Memory HTTP Server for Testing
 *
 * Perfect for testing webhook subscribers without real HTTP calls.
 * Records all requests for easy assertions in tests.
 *
 * @example
 * ```typescript
 * import { MockWebhookServer } from 'autotel-subscribers/testing';
 *
 * const server = new MockWebhookServer();
 * const url = await server.start();
 *
 * // Test your webhook subscriber
 * const subscriber = new WebhookSubscriber({ url });
 * await subscriber.trackEvent('test.event', { foo: 'bar' });
 *
 * // Assert
 * const requests = server.getRequests();
 * expect(requests).toHaveLength(1);
 * expect(requests[0].body.event).toBe('test.event');
 *
 * await server.stop();
 * ```
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
  timestamp: number;
}

export interface MockServerOptions {
  /** Port to listen on (0 = random port) */
  port?: number;
  /** Response status code (default: 200) */
  responseStatus?: number;
  /** Response delay in ms (default: 0) */
  responseDelay?: number;
  /** Response body (default: 'OK') */
  responseBody?: string;
  /** Log requests to console (default: false) */
  logRequests?: boolean;
}

/**
 * In-memory HTTP server for testing webhook subscribers.
 *
 * Records all incoming requests so you can assert on them in tests.
 */
export class MockWebhookServer {
  private server?: http.Server;
  private requests: RecordedRequest[] = [];
  private options: Required<MockServerOptions>;

  constructor(options: MockServerOptions = {}) {
    this.options = {
      port: options.port ?? 0,
      responseStatus: options.responseStatus ?? 200,
      responseDelay: options.responseDelay ?? 0,
      responseBody: options.responseBody ?? 'OK',
      logRequests: options.logRequests ?? false,
    };
  }

  /**
   * Start the mock server and return its URL.
   *
   * @returns Promise resolving to the server URL (e.g., "http://localhost:3000")
   */
  async start(): Promise<string> {
    if (this.server) {
      throw new Error('Server already started');
    }

    this.server = http.createServer((req, res) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        const parsedBody = this.parseBody(body, req.headers['content-type']);

        const request: RecordedRequest = {
          method: req.method || 'GET',
          path: req.url || '/',
          headers: req.headers,
          body: parsedBody,
          timestamp: Date.now(),
        };

        this.requests.push(request);

        if (this.options.logRequests) {
          console.log('[MockWebhookServer]', request.method, request.path, parsedBody);
        }

        // Simulate response delay
        setTimeout(() => {
          res.writeHead(this.options.responseStatus, {
            'Content-Type': 'text/plain',
          });
          res.end(this.options.responseBody);
        }, this.options.responseDelay);
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.options.port, () => {
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo;
    return `http://localhost:${address.port}`;
  }

  /**
   * Stop the mock server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    this.server = undefined;
  }

  /**
   * Get all recorded requests.
   */
  getRequests(): RecordedRequest[] {
    return [...this.requests];
  }

  /**
   * Get requests matching a filter.
   */
  getRequestsWhere(filter: Partial<RecordedRequest>): RecordedRequest[] {
    return this.requests.filter((req) => {
      return Object.entries(filter).every(([key, value]) => {
        return (req as any)[key] === value;
      });
    });
  }

  /**
   * Get the last recorded request.
   */
  getLastRequest(): RecordedRequest | undefined {
    return this.requests.at(-1);
  }

  /**
   * Get the first recorded request.
   */
  getFirstRequest(): RecordedRequest | undefined {
    return this.requests[0];
  }

  /**
   * Clear all recorded requests.
   */
  reset(): void {
    this.requests = [];
  }

  /**
   * Get the number of recorded requests.
   */
  getRequestCount(): number {
    return this.requests.length;
  }

  /**
   * Wait for a specific number of requests.
   *
   * Useful when testing async subscribers.
   *
   * @example
   * ```typescript
   * await subscriber.trackEvent('event1', {});
   * await subscriber.trackEvent('event2', {});
   * await server.waitForRequests(2, 1000); // Wait max 1 second
   * ```
   */
  async waitForRequests(count: number, timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();

    while (this.requests.length < count) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Timeout waiting for ${count} requests (got ${this.requests.length})`
        );
      }

      // Wait 10ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Parse request body based on Content-Type.
   */
  private parseBody(body: string, contentType?: string): any {
    if (!body) {
      return null;
    }

    try {
      if (contentType?.includes('application/json')) {
        return JSON.parse(body);
      }

      if (contentType?.includes('application/x-www-form-urlencoded')) {
        return Object.fromEntries(new URLSearchParams(body));
      }

      return body;
    } catch {
      // If parsing fails, return raw string
      return body;
    }
  }
}
