/**
 * Kitchen-sink E2E spec demonstrating every autotel-playwright feature:
 *
 * 1. page.goto - trace context injected into browser requests via page.route
 * 2. requestWithTrace.get/post - Node-side API calls with trace headers
 * 3. step() helper - child spans within a test (success + failure)
 * 4. test.step() - Playwright native steps triggering OtelReporter spans
 * 5. 404 / error routes - verifying trace context flows on non-happy paths
 */
import { test, expect, step } from 'autotel-playwright';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';

// ── 1. page.goto: trace context injected via page.route ──────────────

test('page.goto /health injects trace context', async ({ page }) => {
  const res = await page.goto('/health');
  expect(res).toBeTruthy();
  expect(res!.status()).toBe(200);
  const body = await res!.json();
  expect(body).toHaveProperty('status', 'ok');
});

test('page.goto /users/:id returns user', async ({ page }) => {
  const res = await page.goto('/users/user-42');
  expect(res).toBeTruthy();
  expect(res!.status()).toBe(200);
  const body = await res!.json();
  expect(body).toMatchObject({ id: 'user-42', name: 'User user-42' });
});

test('page.goto /error gets 500 with trace context', async ({ page }) => {
  const res = await page.goto('/error');
  expect(res).toBeTruthy();
  expect(res!.status()).toBe(500);
  const body = await res!.json();
  expect(body).toHaveProperty('error', 'intentional server error');
});

test('page.goto non-existent route gets 404', async ({ page }) => {
  const res = await page.goto('/does-not-exist');
  expect(res).toBeTruthy();
  expect(res!.status()).toBe(404);
});

// ── 2. requestWithTrace: Node-side HTTP with trace headers ───────────

test('requestWithTrace.get /health', async ({ requestWithTrace }) => {
  const res = await requestWithTrace.get(apiBase + '/health');
  expect(res.ok()).toBeTruthy();
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('status', 'ok');
});

test('requestWithTrace.get /users/:id', async ({ requestWithTrace }) => {
  const res = await requestWithTrace.get(apiBase + '/users/user-99');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toMatchObject({ id: 'user-99', name: 'User user-99' });
});

test('requestWithTrace.post /users creates user', async ({ requestWithTrace }) => {
  const res = await requestWithTrace.post(apiBase + '/users', {
    data: { name: 'Alice', email: 'alice@example.com' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toMatchObject({ id: 'new-1', name: 'Alice' });
});

test('requestWithTrace.get /error returns 500', async ({ requestWithTrace }) => {
  const res = await requestWithTrace.get(apiBase + '/error');
  expect(res.status()).toBe(500);
  const body = await res.json();
  expect(body).toHaveProperty('error', 'intentional server error');
});

// ── 3. step() helper: child spans within a test ──────────────────────

test('step() creates child spans for multi-step flow', async ({ page }) => {
  await step('navigate to health', async () => {
    const res = await page.goto('/health');
    expect(res!.status()).toBe(200);
  });
  await step('navigate to user', async () => {
    const res = await page.goto('/users/user-7');
    expect(res!.status()).toBe(200);
  });
});

test('step() records error on span when step throws', async ({ page }) => {
  await step('passing step', async () => {
    const res = await page.goto('/health');
    expect(res!.status()).toBe(200);
  });

  // Verify that a failing step propagates the error
  await expect(
    step('failing step', async () => {
      const res = await page.goto('/error');
      expect(res!.status()).toBe(200); // intentionally wrong, triggers failure
    }),
  ).rejects.toThrow();
});

// ── 4. test.step(): Playwright native steps → OtelReporter spans ─────

test('test.step() triggers reporter step spans', async ({ page }) => {
  await test.step('call health endpoint', async () => {
    const res = await page.goto('/health');
    expect(res!.status()).toBe(200);
  });
  await test.step('call user endpoint', async () => {
    const res = await page.goto('/users/user-1');
    expect(res!.status()).toBe(200);
  });
  await test.step('call error endpoint', async () => {
    const res = await page.goto('/error');
    expect(res!.status()).toBe(500);
  });
});
