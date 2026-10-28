import { useMutation } from '@tanstack/react-query';
import { api } from '../api';

export function Checkout() {
  const checkout = useMutation({
    mutationKey: ['checkout'],
    mutationFn: async () =>
      (await api.post('/checkout', { order: 'ord_1' })).data,
  });
  return (
    <section>
      <button id="pay" type="button" onClick={() => checkout.mutate()}>
        Pay £42
      </button>
      {checkout.isError && (
        <p role="alert" id="checkout-error">
          {checkout.error.message}
        </p>
      )}
    </section>
  );
}
