import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { trace } from 'autotel';

const users = new Map([['42', { id: '42', name: 'Ada' }]]);

const findUser = trace('db.users.find', async (id: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return users.get(id);
});

const findOrder = trace('db.orders.find', async (_id: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  throw new Error('connection refused');
});

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(function authenticate(
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    next();
  });

  app.param('id', function validateId(_req, res, next, id: string) {
    if (/^\d+$/.test(id)) next();
    else res.status(400).json({ error: 'id must be numeric' });
  });

  app.get(
    '/users/:id',
    async function getUser(req: Request<{ id: string }>, res: Response) {
      const user = await findUser(req.params.id);
      if (user) res.json(user);
      else res.status(404).json({ error: 'not found' });
    },
  );

  app.get(
    '/orders/:id',
    async function loadOrder(req: Request<{ id: string }>, res: Response) {
      res.json(await findOrder(req.params.id));
    },
  );

  app.use(function errorHandler(
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) {
    res.status(500).json({ error: error.message });
  });

  return app;
}
