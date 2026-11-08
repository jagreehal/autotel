// The production 401 nobody could tie to a user: a query fired before login,
// the API's auth middleware rejected it, and neither span said who it was.
// Full mode, axios (XHR), API on another origin.
import axios from 'axios';
import { identify, initFull } from 'autotel-web/full';

initFull({
  service: 'example-web-incident',
  endpoint: 'http://localhost:4318',
  propagateTo: ['localhost:8081'],
  // session.id goes to the API in `baggage`, and only to listed origins.
  baggage: { allowedOrigins: ['localhost:8081'] },
  session: { propagate: true },
});

const api = axios.create({
  baseURL: 'http://localhost:8081',
  validateStatus: () => true,
});
const out = document.querySelector('#out')!;

// Before login: no token yet, so the middleware answers 401.
document.querySelector('#early')!.addEventListener('click', async () => {
  const res = await api.get('/clients/67100478766128ccd2b8ee31');
  out.textContent = `early ${res.status}`;
});

document.querySelector('#login')!.addEventListener('click', async () => {
  identify('67100478766128ccd2b8ee31', {
    'client.id': '65fda45795a9ce7be665f817',
  });
  const res = await api.get('/clients/65fda45795a9ce7be665f817', {
    headers: { applicationToken: 'demo-token' },
  });
  out.textContent = `login ${res.status}`;
});
