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

  it('counts a side-effect import as an imported module', () => {
    // `import 'passport'` binds nothing and still decides that /api/callback handles auth.
    const sideEffect = scanFixture(`
      import { Hono } from 'hono';
      import 'passport';
      const app = new Hono();
      app.get('/api/callback', async (c) => c.json({ ok: true }));
    `);
    expect(sideEffect.map.routes[0]?.sensitivity.level).toBe('high');
    expect(sideEffect.map.routes[0]?.checks['audit']?.status).toBe('fail');

    const bareRequire = (() => {
      const root = projectFiles({
        'src/index.js': `
          const { Hono } = require('hono');
          require('passport');
          const app = new Hono();
          app.get('/api/callback', async (c) => c.json({ ok: true }));
        `,
      });
      return scan({
        projectRoot: root,
        framework: 'hono',
        project: collectProjectFacts(root),
      });
    })();
    expect(bareRequire.map.routes[0]?.sensitivity.level).toBe('high');
  });

  it('reads CommonJS require() bindings the same as import declarations', () => {
    const scanJs = (source: string) => {
      const root = projectFiles({ 'src/index.js': source });
      return scan({
        projectRoot: root,
        framework: 'hono',
        project: collectProjectFacts(root),
      });
    };

    const destructured = scanJs(`
      const { Hono } = require('hono');
      const { instrument, getRequestLogger: requestLog } = require('autotel');
      const app = new Hono();
      app.get('/x', instrument({ key: 'x', fn: async (c) => {
        const log = requestLog();
        log.set({ account: 'a1' });
        return c.json({ ok: true });
      }));
    `);
    expect(destructured.map.routes[0]?.checks['trace']?.status).toBe('pass');
    expect(destructured.map.routes[0]?.checks['context']?.status).toBe('pass');
    expect(destructured.map.score).toBe(100);

    const namespaced = scanJs(`
      const { Hono } = require('hono');
      const autotel = require('autotel');
      const app = new Hono();
      app.get('/x', autotel.instrument({ key: 'x', fn: async (c) => {
        autotel.getRequestLogger().set({ account: 'a1' });
        return c.json({ ok: true });
      }));
    `);
    expect(namespaced.map.routes[0]?.checks['trace']?.status).toBe('pass');
    expect(namespaced.map.routes[0]?.checks['context']?.status).toBe('pass');

    const local = scanJs(`
      const { Hono } = require('hono');
      const { instrument } = require('./my-helpers');
      const app = new Hono();
      app.get('/x', instrument({ key: 'x', fn: async (c) => c.json({ ok: true }) }));
    `);
    expect(local.map.routes[0]?.checks['trace']?.status).toBe('fail');
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

/**
 * Real Hono apps are rarely one file of `app.get('/literal')`. Routes are
 * declared with `@hono/zod-openapi` (`.openapi(createRoute({ method, path }))`)
 * and sub-apps are mounted with `.route(prefix, app)` under a `.basePath()`.
 * The map must report the path a request actually takes, or nothing joins.
 */
describe('hono route composition', () => {
  function routesOf(files: Record<string, string>): string[] {
    const root = projectFiles(files, {
      hono: '^4.0.0',
      '@hono/zod-openapi': '^1.0.0',
    });
    const result = scan({
      projectRoot: root,
      framework: 'hono',
      project: collectProjectFacts(root),
    });
    return result.map.routes
      .map((route) => `${route.method ?? '*'} ${route.path} ${route.file}`)
      .toSorted();
  }

  it('reads method and path from .openapi(createRoute(...))', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
          const app = new OpenAPIHono();
          const getUser = createRoute({ method: 'get', path: '/users/{id}', responses: {} });
          app.openapi(getUser, (c) => c.json({}));
          app.openapi(createRoute({ method: 'post', path: '/users', responses: {} }), (c) => c.json({}));
        `,
      }),
    ).toEqual(['GET /users/:id src/index.ts', 'POST /users src/index.ts']);
  });

  it('keeps paths without a leading slash, as Hono serves them, on apps only', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
          const BASE = 'api/v1';
          const events = new OpenAPIHono()
            .openapi(createRoute({ method: 'get', path: '', responses: {} }), (c) => c.json([]))
            .openapi(createRoute({ method: 'post', path: 'replay', responses: {} }), (c) => c.json({}));
          const cache = new Map();
          cache.get('settings', {});
          export const app = new OpenAPIHono()
            .route(\`\${BASE}/events\`, events)
            .post(\`\${BASE}/event\`, (c) => c.redirect('/api/v1/events', 307));
        `,
      }),
    ).toEqual([
      'GET /api/v1/events src/index.ts',
      'POST /api/v1/event src/index.ts',
      'POST /api/v1/events/replay src/index.ts',
    ]);
  });

  it('keeps paths without a leading slash on a standalone app', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          const app = new Hono();
          app.get('health', (c) => c.text('ok'));
          export const inline = new Hono().post('ping', (c) => c.text('pong'));
        `,
      }),
    ).toEqual(['GET /health src/index.ts', 'POST /ping src/index.ts']);
  });

  it('keeps paths without a leading slash on factory and imported apps', () => {
    expect(
      routesOf({
        'src/app.ts': `
          import { Hono } from 'hono';
          export const app = new Hono();
        `,
        'src/routes.ts': `
          import { createFactory } from 'hono/factory';
          import { app } from './app';
          app.get('health', (c) => c.text('ok'));
          const factory = createFactory();
          export const made = factory.createApp().get('made', (c) => c.text('a'));
          function build() {
            const local = factory.createApp();
            local.get('local', (c) => c.text('b'));
            return local;
          }
        `,
      }),
    ).toEqual([
      'GET /health src/routes.ts',
      'GET /local src/routes.ts',
      'GET /made src/routes.ts',
    ]);
  });

  it('follows a route definition imported from another file', () => {
    expect(
      routesOf({
        'src/routes/users.routes.ts': `
          import { createRoute } from '@hono/zod-openapi';
          export const listUsers = createRoute({ method: 'get', path: '/', responses: {} });
        `,
        'src/routes/users.ts': `
          import { OpenAPIHono } from '@hono/zod-openapi';
          import { listUsers } from './users.routes';
          export const users = new OpenAPIHono().openapi(listUsers, (c) => c.json([]));
        `,
        'src/index.ts': `
          import { OpenAPIHono } from '@hono/zod-openapi';
          import { users } from './routes/users';
          const app = new OpenAPIHono().basePath('/api');
          app.route('/users', users);
        `,
      }),
    ).toEqual(['GET /api/users src/routes/users.ts']);
  });

  it('prefixes sub-apps mounted with .route(), through basePath and default exports', () => {
    expect(
      routesOf({
        'src/orders.ts': `
          import { Hono } from 'hono';
          const orders = new Hono();
          orders.use('*', async (_c, next) => next());
          orders.get('/:id', (c) => c.json({}));
          export default orders;
        `,
        'src/v1.ts': `
          import { Hono } from 'hono';
          import orders from './orders.js';
          export default new Hono().route('/orders', orders).get('/ping', (c) => c.text('ok'));
        `,
        'src/index.ts': `
          import { Hono } from 'hono';
          import v1 from './v1';
          const app = new Hono();
          const api = app.basePath('/api');
          api.route('/v1', v1);
        `,
      }),
    ).toEqual([
      '* /api/v1/orders/* src/orders.ts',
      'GET /api/v1/orders/:id src/orders.ts',
      'GET /api/v1/ping src/v1.ts',
    ]);
  });

  it('applies a base path once, to the routes registered through it', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          const root = new Hono();
          root.get('/', (c) => c.text('home'));
          const api = root.basePath('/api').get('/inline', (c) => c.text('a'));
          api.get('/later', (c) => c.text('b'));
          const v2 = new Hono().basePath('/v2').get('/x', (c) => c.text('c'));
          v2.get('/y', (c) => c.text('d'));
          root.route('/mounted', v2);
        `,
      }),
    ).toEqual([
      'GET / src/index.ts',
      'GET /api/inline src/index.ts',
      'GET /api/later src/index.ts',
      'GET /mounted/v2/x src/index.ts',
      'GET /mounted/v2/y src/index.ts',
    ]);
  });

  it('treats a fluent registration result as the same app, so its mount applies', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          const child = new Hono();
          const routes = child.get('/users', (c) => c.json([]));
          const more = routes.post('/users', (c) => c.json({})).use('*', async (_c, next) => next());
          const app = new Hono();
          app.route('/api', more);
        `,
      }),
    ).toEqual([
      '* /api/* src/index.ts',
      'GET /api/users src/index.ts',
      'POST /api/users src/index.ts',
    ]);
  });

  it('follows a default export that is a fluent chain on another app', () => {
    expect(
      routesOf({
        'src/users.ts': `
          import { Hono } from 'hono';
          const child = new Hono();
          export default child.get('/users', (c) => c.json([]));
        `,
        'src/index.ts': `
          import { Hono } from 'hono';
          import routes from './users';
          const app = new Hono();
          app.route('/api', routes);
        `,
      }),
    ).toEqual(['GET /api/users src/users.ts']);
  });

  it('maps a route whose path is a constant', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          const USERS = '/users';
          const app = new Hono();
          app.get(USERS, (c) => c.json([]));
        `,
      }),
    ).toEqual(['GET /users src/index.ts']);
  });

  it('keeps a base path set inside a factory function', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          function makeRoutes() {
            const r = new Hono().basePath('/x');
            r.get('/y', (c) => c.json([]));
            return r;
          }
          const app = new Hono();
          app.route('/v1', makeRoutes());
        `,
      }),
    ).toEqual(['GET /v1/x/y src/index.ts']);
  });

  it('keeps the routes of apps mounted in a cycle', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          const a = new Hono();
          const b = new Hono();
          a.get('/x', (c) => c.json([]));
          b.get('/y', (c) => c.json([]));
          a.route('/b', b);
          b.route('/a', a);
        `,
      }).length,
    ).toBeGreaterThan(0);
  });

  it('registers on the app a factory call returns, not on the factory', () => {
    expect(
      routesOf({
        'src/users.ts': `
          import { createFactory } from 'hono/factory';
          const factory = createFactory();
          export const routes = factory.createApp().get('/users', (c) => c.json([]));
          export default factory.createApp().get('/orders', (c) => c.json([]));
        `,
        'src/index.ts': `
          import { Hono } from 'hono';
          import orders, { routes } from './users';
          const app = new Hono();
          app.route('/api', routes);
          app.route('/shop', orders);
        `,
      }),
    ).toEqual(['GET /api/users src/users.ts', 'GET /shop/orders src/users.ts']);
  });

  it('maps factory-built sub-apps under a template-literal prefix', () => {
    expect(
      routesOf({
        'src/app.ts': `
          import { Hono } from 'hono';
          import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

          export const app = new Hono();
          app.get('/api/v1/plain', (c) => c.json({ ok: true }));

          const getUser = createRoute({
            method: 'get',
            path: '/users/{id}',
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { description: 'ok' } },
          });
          export function createUserRoutes() {
            const r = new OpenAPIHono();
            r.openapi(getUser, (c) => c.json({ id: c.req.valid('param').id }, 200));
            return r;
          }

          const BASE_URL = '/api/v1';
          const orders = new Hono();
          orders.get('/:id', (c) => c.json({ id: c.req.param('id') }));
          app.route(\`\${BASE_URL}/users\`, createUserRoutes());
          app.route(\`\${BASE_URL}/orders\`, orders);
        `,
      }),
    ).toEqual([
      'GET /api/v1/orders/:id src/app.ts',
      'GET /api/v1/plain src/app.ts',
      'GET /api/v1/users/users/:id src/app.ts',
    ]);
  });

  it('keeps two factories that both name their app r apart', () => {
    expect(
      routesOf({
        'src/users.ts': `
          import { Hono } from 'hono';
          export function users() {
            const r = new Hono();
            r.get('/:id', (c) => { return c.text('u'); });
            return r;
          }
          export const orders = () => { const r = new Hono(); r.get('/:id', (c) => c.text('o')); return r; };
        `,
        'src/index.ts': `
          import { Hono } from 'hono';
          import { users, orders } from './users';
          const PREFIX = '/v1' + '/shop';
          const app = new Hono();
          app.route(PREFIX + '/users', users());
          app.route(\`\${PREFIX}/orders\`, orders());
        `,
      }),
    ).toEqual([
      'GET /v1/shop/orders/:id src/users.ts',
      'GET /v1/shop/users/:id src/users.ts',
    ]);
  });

  it('keeps apps from the same factory apart', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          import { createFactory } from 'hono/factory';
          const factory = createFactory();
          const a = factory.createApp();
          const b = factory.createApp();
          const c = factory.createApp().basePath('/c');
          a.get('/a', (ctx) => ctx.text('a'));
          b.get('/b', (ctx) => ctx.text('b'));
          c.get('/z', (ctx) => ctx.text('c'));
          const app = new Hono();
          app.route('/x', a);
        `,
      }),
    ).toEqual([
      'GET /b src/index.ts',
      'GET /c/z src/index.ts',
      'GET /x/a src/index.ts',
    ]);
  });

  it('keeps hono-openapi (rhinobase) routes, whose path is an ordinary literal', () => {
    expect(
      routesOf({
        'src/index.ts': `
          import { Hono } from 'hono';
          import { describeRoute, validator } from 'hono-openapi';
          const app = new Hono();
          app.get('/users/:id', describeRoute({ responses: {} }), validator('param', schema), (c) => c.json({}));
        `,
      }),
    ).toEqual(['GET /users/:id src/index.ts']);
  });
});

/**
 * Hono mounted in a Next.js catch-all (`app/api/[[...route]]/route.ts`
 * exporting `handle(app)`) is how many apps run Hono. The Next scan saw one
 * catch-all; the API surface is the Hono app's routes.
 */
describe('Hono inside a Next.js catch-all', () => {
  function nextRoutesOf(files: Record<string, string>): string[] {
    const root = projectFiles(files, { next: '^16.0.0', hono: '^4.0.0' });
    const result = scan({
      projectRoot: root,
      framework: 'next',
      project: collectProjectFacts(root),
    });
    return result.map.routes
      .map(
        (route) =>
          `${route.framework} ${route.method ?? '*'} ${route.path} ${route.file}`,
      )
      .toSorted();
  }

  const honoApp = `
    import { Hono } from 'hono';
    import { orders } from './orders';
    export const app = new Hono().basePath('/api');
    app.get('/health', (c) => c.json({ ok: true }));
    app.route('/orders', orders);
  `;
  const orders = `
    import { Hono } from 'hono';
    export const orders = new Hono();
    orders.get('/:id', (c) => c.json({}));
  `;

  it('reports the Hono routes in place of the catch-all', () => {
    expect(
      nextRoutesOf({
        'src/server/app.ts': honoApp,
        'src/server/orders.ts': orders,
        'src/app/api/[[...route]]/route.ts': `
          import { handle } from 'hono/vercel';
          import { app } from '../../../server/app';
          export const GET = handle(app);
          export const POST = handle(app);
        `,
        'src/app/api/plain/route.ts': `
          export async function GET() { return Response.json({}); }
        `,
      }),
    ).toEqual([
      'hono GET /api/health src/server/app.ts',
      'hono GET /api/orders/:id src/server/orders.ts',
      'next GET /api/plain src/app/api/plain/route.ts',
    ]);
  });

  it('follows a tsconfig paths alias to the app', () => {
    expect(
      nextRoutesOf({
        'tsconfig.json': `{
          // comments are allowed here
          "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }
        }`,
        'src/server/app.ts': honoApp,
        'src/server/orders.ts': orders,
        'src/app/api/[...route]/route.ts': `
          import { handle } from 'hono/vercel';
          import { app } from '@/server/app';
          export const GET = handle(app);
        `,
      }),
    ).toEqual([
      'hono GET /api/health src/server/app.ts',
      'hono GET /api/orders/:id src/server/orders.ts',
    ]);
  });
});
