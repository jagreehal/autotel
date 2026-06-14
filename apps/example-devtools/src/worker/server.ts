import 'dotenv/config';
import { init } from 'autotel';
import { startWorker } from './index.js';

const port = Number(process.env.WORKER_PORT || 3001);
const serviceName = process.env.WORKER_SERVICE_NAME || 'shop-worker';

init({
  service: serviceName,
  endpoint: process.env.DEVTOOLS_URL || 'http://127.0.0.1:4318',
  debug: false,
});

startWorker(port, serviceName);
