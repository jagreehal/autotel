import { expect, test, type Page } from '@playwright/test';

/**
 * The three signals that exist for the consent moment, measured against a real
 * browser rather than a stand-in.
 *
 * WebMCP runs on the session the user is already logged into, so the moment a
 * human says yes is the only checkpoint there is — and the dialogue showing
 * them that moment is page code like any other. None of this makes the yes
 * honest; that is the host's job. It makes a dishonest one leave a record.
 */

interface RenderedSpan {
  attributes: Record<string, string>;
  name: string;
}

/** The page renders each span it produces, so the DOM is the span sink. */
const spans = (page: Page): Promise<RenderedSpan[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#spans > div')].map((entry) => {
      const attributes: Record<string, string> = {};
      for (const row of entry.querySelectorAll('div.flex')) {
        const [key, value] = row.querySelectorAll('code');
        if (key && value) attributes[key.textContent ?? ''] = value.textContent ?? '';
      }
      return {
        attributes,
        name: entry.querySelector('span.font-mono')?.textContent ?? '',
      };
    }),
  );

const spanNamed = async (page: Page, name: string) =>
  (await spans(page)).find((span) => span.name === name);

test.beforeEach(async ({ page }) => {
  await page.goto('/apps/example-webmcp/');
  // Feature-detect, do not version-check: a version gate passes on a build
  // with the flags off, and fails on a future build that renames nothing.
  const available = await page.evaluate(
    () => typeof document.modelContext?.registerTool === 'function',
  );
  test.skip(
    !available,
    'This Chrome exposes no document.modelContext. Run Chrome 152+ with ' +
      '--enable-experimental-web-platform-features and --enable-features=WebMCPTesting.',
  );
  await expect(page.locator('#support')).toContainText('WebMCP is available');
});

test('registration spans reach the page from the real browser', async ({
  page,
}) => {
  const registrations = (await spans(page)).filter(
    (span) => span.name === 'webmcp.tool.register',
  );

  expect(registrations.length).toBeGreaterThan(0);
  // The annotations Chrome silently discarded, which is the attribute you
  // cannot get any other way.
  const search = registrations.find(
    (span) => span.attributes['webmcp.tool.name'] === 'search',
  );
  expect(search?.attributes['webmcp.annotations.dropped']).toContain(
    'destructiveHint',
  );
});

test('a consent decision lands on the same trace as the call it authorised', async ({
  page,
}) => {
  await page.click('#honest-consent');
  // The call is async: the consent span is emitted before it, the execution
  // span when it settles.
  await expect
    .poll(async () => await spanNamed(page, 'execute_tool checkout'))
    .toBeDefined();

  const consent = await spanNamed(page, 'webmcp.consent');
  const execution = await spanNamed(page, 'execute_tool checkout');

  expect(consent?.attributes['webmcp.consent.granted']).toBe('true');
  expect(consent?.attributes['webmcp.consent.mismatch']).toBe('false');
  expect(consent?.attributes['gen_ai.tool.name']).toBe('checkout');
  // Same installation, same tool, same descriptor: the join that makes
  // "approved, then ran" a query rather than an investigation.
  expect(consent?.attributes['webmcp.installation.id']).toBe(
    execution?.attributes['webmcp.installation.id'],
  );
  expect(consent?.attributes['webmcp.tool.descriptor']).toBe(
    execution?.attributes['webmcp.tool.descriptor'],
  );
});

test('a label that is not the call it authorised is recorded as a mismatch', async ({
  page,
}) => {
  await page.click('#lying-consent');
  await expect
    .poll(async () => await spanNamed(page, 'execute_tool checkout'))
    .toBeDefined();

  const consent = await spanNamed(page, 'webmcp.consent');
  expect(consent?.attributes['webmcp.consent.shown']).toBe('add_to_cart');
  expect(consent?.attributes['webmcp.consent.resolved']).toBe('checkout');
  expect(consent?.attributes['webmcp.consent.mismatch']).toBe('true');
});

test('a call made from inside a handler records what it ran under', async ({
  page,
}) => {
  // One yes, two calls: `restock` calls `search`, and only `restock` was ever
  // shown to anyone.
  await page.click('button:text-is("restock")');

  await expect
    .poll(async () => (await spanNamed(page, 'execute_tool search'))?.attributes)
    .toMatchObject({
      'webmcp.execute.depth': '1',
      'webmcp.execute.parent': 'restock',
    });

  const outer = await spanNamed(page, 'execute_tool restock');
  expect(outer?.attributes['webmcp.execute.depth']).toBe('0');
  expect(outer?.attributes['webmcp.execute.parent']).toBeUndefined();

  // Exactly one consent span for two executions.
  const rendered = await spans(page);
  expect(rendered.filter((s) => s.name === 'webmcp.consent')).toHaveLength(1);
  expect(rendered.filter((s) => s.name.startsWith('execute_tool '))).toHaveLength(2);
});

test('a handler swapped behind an unchanged descriptor goes unnoticed by default', async ({
  page,
}) => {
  await page.click('#swap-handler');

  await expect
    .poll(async () =>
      (await spans(page)).filter((span) => span.name === 'webmcp.tool.register'),
    )
    .not.toHaveLength(0);

  const searches = (await spans(page)).filter(
    (span) =>
      span.name === 'webmcp.tool.register' &&
      span.attributes['webmcp.tool.name'] === 'search',
  );
  // Same name, same description, same schema, different function: the
  // descriptor cannot see it, and nothing claims otherwise.
  expect(searches.some((s) => s.attributes['webmcp.tool.redefined'])).toBe(
    false,
  );
});

test('folding the handler into the fingerprint catches that swap', async ({
  page,
}) => {
  await page.check('#fingerprint-handler');
  await page.click('#swap-handler');

  await expect
    .poll(async () =>
      (await spans(page)).some(
        (span) =>
          span.name === 'webmcp.tool.register' &&
          span.attributes['webmcp.tool.name'] === 'search' &&
          span.attributes['webmcp.tool.redefined'] === 'true',
      ),
    )
    .toBe(true);
});
