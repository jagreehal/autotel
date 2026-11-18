import { init, shutdown } from 'autotel';
import { createApp } from './app.ts';
import { instrumentExpress } from './express-spans.ts';

// Span trees print to the console; add `endpoint` to export over OTLP.
init({ service: 'express5-example', debug: 'pretty' });
instrumentExpress();

const port = Number(process.env.PORT ?? 3000);
const server = createApp().listen(port, () => {
  console.log(`http://localhost:${port}/users/42`);
  console.log(`http://localhost:${port}/orders/7`);
});

process.once('SIGINT', () => {
  server.close();
  void shutdown();
});
