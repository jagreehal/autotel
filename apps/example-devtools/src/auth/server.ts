import 'dotenv/config';
import { init } from 'autotel';
import { startAuth } from './index.js';

const port = Number(process.env.AUTH_PORT || 3002);
const serviceName = process.env.AUTH_SERVICE_NAME || 'shop-auth';

init({
  service: serviceName,
  endpoint: process.env.DEVTOOLS_URL || 'http://127.0.0.1:4318',
  debug: false,
});

startAuth(port, serviceName);
