import 'dotenv/config';
import { init } from 'autotel';
import { startApi } from './index.js';

const port = Number(process.env.API_PORT || 3000);
const devtoolsUrl = process.env.DEVTOOLS_URL || 'http://127.0.0.1:4318';

init({
  service: process.env.API_SERVICE_NAME || 'shop-api',
  endpoint: devtoolsUrl,
  debug: false,
});

startApi(port, {
  authUrl: process.env.AUTH_URL || 'http://127.0.0.1:3002',
  workerUrl: process.env.WORKER_URL || 'http://127.0.0.1:3001',
  devtoolsUrl,
  browserServiceName: process.env.BROWSER_SERVICE_NAME || 'shop-web',
  apiServiceName: process.env.API_SERVICE_NAME || 'shop-api',
  authServiceName: process.env.AUTH_SERVICE_NAME || 'shop-auth',
  workerServiceName: process.env.WORKER_SERVICE_NAME || 'shop-worker',
});
