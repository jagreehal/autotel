// PaymentService — captures payment, retries on soft declines, emits
// PaymentCaptured or PaymentFailed.

import { span } from 'autotel';
import { traceConsumer } from 'autotel/messaging';
import type { OrderPlacedMessage } from '../shared/types';
import { paymentCapturedEvent, paymentFailedEvent } from '../shared/events';
import { isoNow } from '../shared/clock';

type CaptureResult =
  | { status: 'succeeded'; pspTransactionId: string }
  | { status: 'declined'; declineCode: string; soft: boolean };

type StripeStub = {
  charges: { create: (args: { amount: number }) => Promise<CaptureResult> };
};

let stripe: StripeStub = {
  charges: {
    create: async () => ({
      status: 'succeeded',
      pspTransactionId: 'ch_' + Math.random().toString(36).slice(2, 10),
    }),
  },
};

/** Used by demos and tests that want to simulate declines. */
export function setStripeStub(next: StripeStub): void {
  stripe = next;
}

const MAX_ATTEMPTS = 3;
const BACKOFFS_MS = [200, 800];

export const handleOrderPlaced = traceConsumer({
  system: 'kafka',
  destination: 'orders.events',
})(() => async (msg: OrderPlacedMessage) => {
  let lastDecline = '';
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts++;
    const result = await span('payment.capture', async (s) => {
      s.setAttribute('payment.psp', 'stripe');
      s.setAttribute('payment.amount_cents', msg.totalCents);
      s.setAttribute('payment.attempt', attempts);
      return stripe.charges.create({ amount: msg.totalCents });
    });

    if (result.status === 'succeeded') {
      paymentCapturedEvent.track({
        orderId: msg.id,
        amountCents: msg.totalCents,
        currency: msg.currency,
        psp: 'stripe',
        pspTransactionId: result.pspTransactionId,
        capturedAt: isoNow(),
        _autotel: { channel: 'payments.events', producer: 'PaymentService' },
      });
      return;
    }

    lastDecline = result.declineCode;
    if (!result.soft || i === MAX_ATTEMPTS - 1) break;
    await new Promise((r) => setTimeout(r, BACKOFFS_MS[i]));
  }

  paymentFailedEvent.track({
    orderId: msg.id,
    declineCode: lastDecline || 'other',
    attempts,
    psp: 'stripe',
    failedAt: isoNow(),
    _autotel: { channel: 'payments.events', producer: 'PaymentService' },
  });
});
