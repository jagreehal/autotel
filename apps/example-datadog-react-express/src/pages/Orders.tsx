import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

type Order = { id: string; item: string; total: number };

export function Orders() {
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get<Order[]>('/orders')).data,
  });
  if (orders.isPending) return <p>Loading orders…</p>;
  if (orders.isError) return <p role="alert">{orders.error.message}</p>;
  return (
    <ul id="orders">
      {orders.data.map((order) => (
        <li key={order.id}>
          {order.item}: £{order.total}
        </li>
      ))}
    </ul>
  );
}
