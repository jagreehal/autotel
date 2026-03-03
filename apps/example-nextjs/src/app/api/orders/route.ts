import {
  createStructuredError,
  parseError,
  useLogger,
  withAutotel,
} from 'autotel-adapters/next';

type Order = {
  id: string;
  status: 'processing' | 'shipped' | 'delivered';
  total: number;
};

const getOrder = async (orderId: string): Promise<Order> => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  return {
    id: orderId,
    status: 'processing',
    total: 129.99,
  };
};

export const GET = withAutotel(
  async (request: Request): Promise<Response> => {
    const log = useLogger(request);

    try {
      const url = new URL(request.url);
      const orderId = url.searchParams.get('id');

      if (!orderId) {
        throw createStructuredError({
          message: 'Missing required query parameter: id',
          why: 'The API needs an order id to load a specific order.',
          fix: 'Call /api/orders?id=<order-id>.',
          status: 400,
          code: 'ORDER_ID_REQUIRED',
        });
      }

      log.set({ orderId, endpoint: '/api/orders' });
      const order = await getOrder(orderId);
      log.info('Fetched order', { status: order.status });

      return Response.json({ ok: true, order });
    } catch (error) {
      const parsed = parseError(error);
      log.error(error instanceof Error ? error : parsed.message, {
        endpoint: '/api/orders',
        errorStatus: parsed.status,
        errorWhy: parsed.why,
        errorCode: parsed.code,
      });

      return Response.json(
        {
          ok: false,
          error: parsed.message,
          why: parsed.why,
          fix: parsed.fix,
          code: parsed.code,
        },
        { status: parsed.status },
      );
    }
  },
  {
    spanName: 'next.api.orders.get',
  },
);

