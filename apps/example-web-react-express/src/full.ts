// Full mode, default capture: spans, web vitals with attribution, errors.
import { initFull } from 'autotel-web/full';

initFull({
  service: 'example-web-full',
  endpoint: import.meta.env.VITE_OTLP_ENDPOINT ?? 'http://localhost:4318',
  propagateTo: ['localhost:8081'],
});

const out = document.querySelector('#out')!;

// A slow interaction: the handler blocks the main thread for 600ms.
document
  .querySelector('#checkout')!
  .addEventListener('click', function renderCart() {
    const end = performance.now() + 600;
    while (performance.now() < end);
    out.textContent = 'cart rendered';
  });

// A backend failure: the API throws.
document.querySelector('#pay')!.addEventListener('click', async () => {
  const res = await fetch('http://localhost:8081/payments', {
    method: 'POST',
    headers: { applicationToken: 'demo-token' },
  });
  out.textContent = `pay ${res.status}`;
});
