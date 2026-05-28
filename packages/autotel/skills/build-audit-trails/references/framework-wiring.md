# Framework wiring for audit trails

Each handler below records an authorization decision (allow and deny) and emits one audit span. They assume the `audit()` / `withAuthz()` helpers from Step 1–2 of the skill, or the `withAudit` helper from `autotel-audit`. Keep the audit call inside the traced request so it inherits the trace context.

The rule across every framework is the same: wrap the authorization decision so both branches reach the audit pipeline, and never put raw payloads on the span.

## Next.js (App Router)

```typescript
// app/admin/users/[id]/route.ts
import { withAuthz } from '@/lib/audit';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  return withAuthz(
    {
      action: 'user.delete',
      resource: { type: 'user', id: params.id },
      actor: { id: req.headers.get('x-user-id')!, role: 'admin' },
    },
    async () => ({ allow: await canDelete(req, params.id) }),
    async () => {
      await db.user.delete({ where: { id: params.id } });
      return Response.json({ ok: true });
    },
  );
}
```

## Nuxt / Nitro

```typescript
// server/api/secrets/[id].delete.ts
import { withAuthz } from '~/server/utils/audit';

export default defineEventHandler((event) =>
  withAuthz(
    {
      action: 'secret.delete',
      resource: { type: 'secret', id: getRouterParam(event, 'id')! },
      actor: { id: event.context.user.id, role: event.context.user.role },
    },
    async () => ({ allow: await canManageSecret(event) }),
    async () => {
      await secrets.delete(getRouterParam(event, 'id')!);
      return { ok: true };
    },
  ),
);
```

## NestJS

Wrap the audited work inside the service or an interceptor. The decision lives next to the business logic:

```typescript
@Injectable()
export class UsersService {
  async remove(id: string, actor: Actor) {
    return withAuthz(
      { action: 'user.delete', resource: { type: 'user', id }, actor },
      async () => ({ allow: actor.role === 'admin' }),
      async () => this.repo.delete(id),
    );
  }
}
```

## Express

```typescript
import { withAuthz } from './audit';

app.delete('/admin/users/:id', async (req, res, next) => {
  try {
    await withAuthz(
      {
        action: 'user.delete',
        resource: { type: 'user', id: req.params.id },
        actor: { id: req.user.id, role: req.user.role },
      },
      async () => ({ allow: req.user.role === 'admin' }),
      async () => db.user.delete({ where: { id: req.params.id } }),
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

## Fastify

```typescript
import { withAuthz } from './audit';

fastify.delete('/admin/users/:id', async (request, reply) => {
  await withAuthz(
    {
      action: 'user.delete',
      resource: { type: 'user', id: (request.params as { id: string }).id },
      actor: { id: request.user.id, role: request.user.role },
    },
    async () => ({ allow: request.user.role === 'admin' }),
    async () =>
      db.user.delete({ where: { id: (request.params as { id: string }).id } }),
  );
  return { ok: true };
});
```

## Hono

```typescript
import { withAuthz } from './audit';

app.post('/secrets/:id/read', (c) =>
  withAuthz(
    {
      action: 'secret.read',
      resource: { type: 'secret', id: c.req.param('id') },
      actor: { id: c.var.user.id, role: c.var.user.role },
    },
    () => requireScope(c, 'secrets:read'),
    async () => c.json({ value: await secrets.read(c.req.param('id')) }),
  ),
);
```

## Cloudflare Workers

Audit from inside `defineWorkerFetch` so `ctx.waitUntil` exports the audit span before the response returns:

```typescript
import { defineWorkerFetch } from 'autotel-cloudflare';
import { withAuthz } from './audit';

export default defineWorkerFetch(
  { service: { name: 'admin-api' } },
  async (request, env, ctx, log) =>
    withAuthz(
      {
        action: 'data.export',
        resource: { type: 'project', id: 'p_123' },
        actor: { id: 'usr_42' },
      },
      async () => ({ allow: true }),
      async () => Response.json({ ok: true }),
    ),
);
```

## AWS Lambda

Wrap the traced handler; the audit span is flushed when the handler settles:

```typescript
import { withAuthz } from './audit';

export const handler = async (event: APIGatewayProxyEventV2) =>
  withAuthz(
    {
      action: 'invoice.void',
      resource: { type: 'invoice', id: event.pathParameters!.id! },
      actor: { id: event.requestContext.authorizer!.userId },
    },
    async () => ({ allow: await canVoid(event) }),
    async () => {
      await invoices.void(event.pathParameters!.id!);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    },
  );
```

## Standalone scripts and cron jobs

Outside a request there is no ambient trace context. Wrap the job in `trace()` first so the audit span has a parent, and set the actor to the system principal:

```typescript
import { trace } from 'autotel';
import { withAudit } from 'autotel-audit';

export const nightlyPurge = trace(async function nightlyPurge() {
  await withAudit(
    {
      action: 'data.purge',
      resource: 'expired-sessions',
      actorId: 'system:cron',
      category: 'maintenance',
    },
    async () => sessions.purgeExpired(),
  );
});
```
