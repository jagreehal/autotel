import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scan } from './scan';
import { collectProjectFacts } from './project-facts';
import { compareToBaseline, hasRegressed, loadBaseline } from './baseline';
import type { MapFile } from './types';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A throwaway Hono project on disk — the scan reads real files, so tests write real files. */
function project(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-map-'));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: { hono: '^4.0.0', autotel: '^1.0.0' },
    }),
  );
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), source);
  return root;
}

function projectFiles(
  files: Record<string, string>,
  dependencies?: Record<string, string>,
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-map-'));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: dependencies ?? {
        hono: '^4.0.0',
        autotel: '^1.0.0',
      },
    }),
  );
  for (const [file, source] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return root;
}

function scanFixture(source: string): ReturnType<typeof scan> {
  const root = project(source);
  return scan({
    projectRoot: root,
    framework: 'hono',
    project: collectProjectFacts(root),
  });
}

const INSTRUMENTED = `
import { Hono } from 'hono';
import { instrument, getRequestLogger } from 'autotel';

const app = new Hono();

app.get('/users/:id', instrument({ key: 'get user', fn: async (c) => {
  const log = getRequestLogger();
  log.set({ 'user.id': c.req.param('id') });
  return c.json({ ok: true });
}));
`;

const DARK = `
import { Hono } from 'hono';

const app = new Hono();

app.get('/users/:id', async (c) => c.json({ id: c.req.param('id') }));
`;

describe('scan', () => {
  it('scores an instrumented handler at 100 and a dark one at 35', () => {
    expect(scanFixture(INSTRUMENTED).map.score).toBe(100);

    const dark = scanFixture(DARK);
    expect(dark.map.score).toBe(35);
    expect(dark.summary.dark).toBe(1);
  });

  it('exempts health checks instead of counting them as gaps', () => {
    const result = scanFixture(`
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/health', (c) => c.json({ ok: true }));
    `);

    expect(result.summary.exempt).toBe(1);
    // Nothing to instrument, so the free 100 must not lift the project score.
    expect(result.map.score).toBe(100);
    expect(result.map.routes[0]?.checks['trace']?.status).toBe('n/a');
  });

  it('scopes facts to the handler, so routes in one file score separately', () => {
    const result = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger } from 'autotel';
      const app = new Hono();

      app.get('/a', instrument({ key: 'a', fn: async (c) => {
        getRequestLogger().set({ a: 1 });
        return c.json({ ok: true });
      }));

      app.get('/b', async (c) => c.json({ ok: true }));
    `);

    const scores = Object.fromEntries(
      result.map.routes.map((route) => [route.path, route.score]),
    );
    expect(scores['/a']).toBe(100);
    expect(scores['/b']).toBeLessThan(100);
    expect(
      result.map.routes.find((route) => route.path === '/b')?.checks['trace']
        ?.status,
    ).toBe('fail');
  });

  it('does not mistake non-path method calls for router registrations', () => {
    const result = scanFixture(`
      import { Hono } from 'hono';
      const app = new Hono();
      const db = { get(query, callback) { callback(); } };
      db.get('select * from users', () => undefined);
      app.get('/users', (c) => c.json({ ok: true }));
    `);

    expect(result.map.routes.map((route) => route.path)).toEqual(['/users']);
  });

  it('resolves aliased autotel imports and rejects unrelated Map.set calls', () => {
    const aliased = scanFixture(`
      import { Hono } from 'hono';
      import { instrument as observe, getRequestLogger as requestLog } from 'autotel';
      const app = new Hono();
      app.get('/x', observe({ key: 'x', fn: async (c) => {
        const log = requestLog();
        log.set({ account: 'a1' });
        return c.json({ ok: true });
      }));
    `);
    expect(aliased.map.routes[0]?.checks['trace']?.status).toBe('pass');
    expect(aliased.map.routes[0]?.checks['context']?.status).toBe('pass');

    const unrelated = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger } from 'autotel';
      const app = new Hono();
      app.get('/x', instrument({ key: 'x', fn: async (c) => {
        getRequestLogger();
        new Map().set('account', 'a1');
        return c.json({ ok: true });
      }));
    `);
    expect(unrelated.map.routes[0]?.checks['context']?.status).toBe('fail');
  });

  it('requires an actual integration call before awarding ambient tracing', () => {
    const commentedRoot = projectFiles({
      'src/app.ts': `
        // We may add autotelMiddleware() later.
        import { withAutotel } from 'autotel-adapters/next';
        export const oneHandler = withAutotel(() => true);
        export const app = {};
      `,
      'src/index.ts': `
        import { Hono } from 'hono';
        const app = new Hono();
        app.get('/dark', (c) => c.json({ ok: true }));
      `,
    });
    const commentedProject = collectProjectFacts(commentedRoot);
    expect(commentedProject.ambientTracing).toBe(false);
    expect(
      scan({
        projectRoot: commentedRoot,
        framework: 'hono',
        project: commentedProject,
      }).map.routes[0]?.checks['trace']?.status,
    ).toBe('fail');

    const wiredRoot = projectFiles({
      'src/app.ts': `
        import { autotelMiddleware as observe } from 'autotel-adapters/hono';
        observe();
      `,
    });
    expect(collectProjectFacts(wiredRoot).ambientTracing).toBe(true);
  });

  it('follows a named router handler without leaking sibling facts', () => {
    const result = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger } from 'autotel';
      const app = new Hono();
      const named = instrument({ key: 'named', fn: async (c) => {
        getRequestLogger().set({ account: 'a1' });
        return c.json({ ok: true });
      });
      app.get('/named', named);
      app.get('/dark', async (c) => c.json({ ok: true }));
    `);
    const named = result.map.routes.find((route) => route.path === '/named');
    const dark = result.map.routes.find((route) => route.path === '/dark');
    expect(named?.checks['trace']?.status).toBe('pass');
    expect(named?.checks['context']?.status).toBe('pass');
    expect(dark?.checks['trace']?.status).toBe('fail');
  });

  it('requires why and fix on structured errors', () => {
    const result = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger, createStructuredError } from 'autotel';
      const app = new Hono();
      app.get('/x', instrument({ key: 'x', fn: async () => {
        getRequestLogger().set({ operation: 'x' });
        throw createStructuredError({ message: 'Nope', status: 400, why: 'bad input' });
      }));
    `);
    expect(
      result.map.routes[0]?.checks['structured-errors']?.message,
    ).toContain('missing fix');
  });

  it('checks only pages with data calls and requires a guarded error path', () => {
    const root = projectFiles(
      {
        'app/orders/page.tsx': `
          export default async function Orders() {
            const response = await fetch('https://example.com/orders');
            return response.status;
          }
        `,
        'app/safe/page.tsx': `
          export default async function Safe() {
            try {
              const response = await fetch('https://example.com/safe');
              return response.status;
            } catch {
              return 0;
            }
          }
        `,
        'app/static/page.tsx': `export default function Static() { return 'ok'; }`,
      },
      { next: '^16.0.0', autotel: '^1.0.0' },
    );
    const result = scan({
      projectRoot: root,
      framework: 'next',
      project: collectProjectFacts(root),
    });
    const byPath = Object.fromEntries(
      result.map.routes.map((route) => [route.path, route]),
    );
    expect(byPath['/orders']?.checks['page-error-handling']?.status).toBe(
      'fail',
    );
    expect(byPath['/safe']?.checks['page-error-handling']?.status).toBe('pass');
    expect(byPath['/static']?.checks['page-error-handling']?.status).toBe(
      'n/a',
    );
  });

  it('classifies TanStack pages and server functions from imported calls', () => {
    const root = projectFiles(
      {
        'src/routes/orders.tsx': `
          import { createFileRoute as definePage } from '@tanstack/react-router';
          export const Route = definePage('/orders')({ component: () => null });
        `,
        'src/routes/save.ts': `
          import * as Start from '@tanstack/react-start';
          export const save = Start.createServerFn().handler(() => true);
        `,
        'src/routes/comment.ts': `
          // createFileRoute('/comment') is intentionally only documentation.
          export const note = 'not a route';
        `,
      },
      {
        '@tanstack/react-start': '^1.0.0',
        '@tanstack/react-router': '^1.0.0',
        autotel: '^1.0.0',
      },
    );
    const result = scan({
      projectRoot: root,
      framework: 'tanstack-start',
      project: collectProjectFacts(root),
    });

    expect(result.map.routes.map(({ path, kind }) => ({ path, kind }))).toEqual(
      [
        { path: '/orders', kind: 'page' },
        { path: '/save', kind: 'server-fn' },
      ],
    );
  });

  it('suggests a catalog only for repeated inline errors in a catalog project', () => {
    const root = projectFiles({
      'src/catalog.ts': `
        import { defineErrorCatalog } from 'autotel';
        export const errors = defineErrorCatalog('orders', {});
      `,
      'src/index.ts': `
        import { Hono } from 'hono';
        import { createStructuredError } from 'autotel';
        const app = new Hono();
        app.get('/a', () => { throw createStructuredError({
          status: 409, message: 'Order conflict', why: 'duplicate', fix: 'retry'
        }); });
      `,
      'src/other.ts': `
        import { Hono } from 'hono';
        import { createStructuredError } from 'autotel';
        const app = new Hono();
        app.get('/b', () => { throw createStructuredError({
          status: 409, message: 'Order conflict', why: 'duplicate', fix: 'retry'
        }); });
      `,
    });
    const result = scan({
      projectRoot: root,
      framework: 'hono',
      project: collectProjectFacts(root),
    });
    expect(
      result.map.routes.every(
        (route) => route.suggestions['error-catalog']?.status === 'fail',
      ),
    ).toBe(true);
  });

  it('suggests audit coverage for ordinary writes only after audit adoption', () => {
    const root = projectFiles(
      {
        'src/audit.ts': `
          import { securityEvent } from 'autotel-audit';
          export const record = () => securityEvent({
            name: 'account.login', category: 'authentication', outcome: 'success'
          });
        `,
        'src/index.ts': `
          import { Hono } from 'hono';
          const app = new Hono();
          const db = { update() { return true; } };
          app.post('/profile', (c) => {
            db.update();
            return c.json({ ok: true });
          });
        `,
      },
      {
        hono: '^4.0.0',
        autotel: '^1.0.0',
        'autotel-audit': '^1.0.0',
      },
    );
    const result = scan({
      projectRoot: root,
      framework: 'hono',
      project: collectProjectFacts(root),
    });
    expect(result.map.routes[0]?.suggestions['audit-coverage']?.status).toBe(
      'fail',
    );
  });

  it('requires an audit trail on money and auth paths only', () => {
    const money = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger } from 'autotel';
      const app = new Hono();
      app.post('/checkout', instrument({ key: 'checkout', fn: async (c) => {
        getRequestLogger().set({ cart: 1 });
        return c.json({ ok: true });
      }));
    `);
    expect(money.map.routes[0]?.sensitivity.level).toBe('high');
    expect(money.map.routes[0]?.checks['audit']?.status).toBe('fail');

    expect(
      scanFixture(INSTRUMENTED).map.routes[0]?.checks['audit']?.status,
    ).toBe('n/a');
  });

  it('reports a swallowed catch and not a handled one', () => {
    const swallowed = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger } from 'autotel';
      const app = new Hono();
      app.get('/x', instrument({ key: 'x', fn: async (c) => {
        getRequestLogger().set({ a: 1 });
        try { return c.json({ ok: true }); } catch { return c.json({ ok: false }); }
      }));
    `);
    expect(swallowed.map.routes[0]?.checks['error-handling']?.status).toBe(
      'fail',
    );

    const handled = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger } from 'autotel';
      const app = new Hono();
      app.get('/x', instrument({ key: 'x', fn: async (c) => {
        const log = getRequestLogger();
        log.set({ a: 1 });
        try { return c.json({ ok: true }); } catch (error) { log.error(error); throw error; }
      }));
    `);
    expect(handled.map.routes[0]?.checks['error-handling']?.status).toBe(
      'pass',
    );
  });

  it('waives a finding named by a disable comment, and warns on an unknown id', () => {
    const result = scanFixture(`
      import { Hono } from 'hono';
      import { instrument, getRequestLogger } from 'autotel';
      // autotel-map-disable error-handling -- safe fallback on purpose
      // autotel-map-disable nonsense -- typo
      const app = new Hono();
      app.get('/x', instrument({ key: 'x', fn: async (c) => {
        getRequestLogger().set({ a: 1 });
        try { return c.json({ ok: true }); } catch { return c.json({ ok: false }); }
      }));
    `);

    const check = result.map.routes[0]?.checks['error-handling'];
    expect(check?.status).toBe('n/a');
    expect(check?.suppressed).toBe(true);
    expect(result.summary.suppressedChecks).toBe(1);
    // A suppressed check costs no score, but is not counted as coverage either.
    expect(result.map.score).toBe(100);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nonsense');
  });

  it('supports comma-separated, next-line, same-line, and all-check waivers', () => {
    const result = scanFixture(`
      import { Hono } from 'hono';
      const app = new Hono();
      // autotel-map-disable-next-line trace, context -- intentionally dark
      app.get('/x', async (c) => c.json({ ok: true }));
      app.get('/y', async (c) => { throw new Error('x'); }); // autotel-map-disable-line structured-errors
    `);
    const x = result.map.routes.find((route) => route.path === '/x');
    const y = result.map.routes.find((route) => route.path === '/y');
    expect(x?.checks['trace']?.suppressed).toBe(true);
    expect(x?.checks['context']?.suppressed).toBe(true);
    expect(y?.checks['structured-errors']?.suppressed).toBe(true);
  });
});

describe('baseline', () => {
  const source = { kind: 'file' as const, label: 'autotel.map.json' };

  it('reports a malformed local baseline instead of silently using Git', () => {
    const root = projectFiles({
      'autotel.map.json': '{ invalid',
    });

    expect(() => loadBaseline(root)).toThrow(/not valid JSON/);
  });

  it('gates on a check that regressed, not on a new dark route', () => {
    const before = scanFixture(INSTRUMENTED).map;
    const after = scanFixture(DARK).map;

    const regressed = compareToBaseline(before, after, source);
    expect(regressed.regressions.map((r) => r.check)).toContain('trace');
    expect(hasRegressed(regressed)).toBe(true);

    const withNewRoute: MapFile = {
      ...before,
      routes: [
        ...before.routes,
        { ...after.routes[0]!, id: 'GET /new (src/new.ts)', path: '/new' },
      ],
    };
    const added = compareToBaseline(before, withNewRoute, source);
    expect(added.added).toHaveLength(1);
    expect(added.added[0]?.dark).toBe(true);
    expect(hasRegressed(added)).toBe(false);
  });
});
