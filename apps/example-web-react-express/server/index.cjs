const express = require('express');
const helmet = require('helmet');

const app = express();
app.use(helmet());
app.use(express.json());

// Hand-rolled CORS, as many Express 4 APIs have it. The browser only sends
// `traceparent` cross-origin if the preflight lists it, so it has to be added
// here. CORS_ALLOW_TRACEPARENT=false reproduces an API that has not added it.
const allowHeaders = [
  'Origin',
  'X-Requested-With',
  'Content-Type',
  'Accept',
  'applicationToken',
  'token',
];
if (process.env.CORS_ALLOW_TRACEPARENT !== 'false')
  allowHeaders.push('traceparent', 'baggage');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Methods',
    'DELETE, GET, HEAD, POST, PUT, OPTIONS',
  );
  res.header('Access-Control-Allow-Headers', allowHeaders.join(', '));
  res.header('Cross-Origin-Embedder-Policy', 'require-corp');
  if (req.method === 'OPTIONS' && req.headers.origin)
    return res.status(200).json();
  if (req.header('applicationToken') !== 'demo-token') {
    return res.status(401).json({ message: 'Application token is invalid' });
  }
  next();
});

app.get('/clients/:id', (req, res) => {
  console.log(`request traceparent=${req.headers.traceparent ?? '-'}`);
  res.json({ id: req.params.id, name: 'Acme' });
});

app.post('/clients', (req, res) => {
  console.log(`request traceparent=${req.headers.traceparent ?? '-'}`);
  res.status(201).json({ id: 'c2', ...req.body });
});

const port = Number(process.env.PORT ?? 8081);
app.listen(port, () =>
  console.log(`API listening on http://localhost:${port}`),
);
