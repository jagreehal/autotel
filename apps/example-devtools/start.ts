import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDevtools } from 'autotel-devtools';
import { createDb, schema } from './src/shared/db/client.js';
import { envPort, pickPort } from './src/shared/runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const pnpmCmd = isWindows ? 'pnpm.cmd' : 'pnpm';

const db = createDb();
const { users, sessions, products } = schema;

async function seedDatabase() {
  const existingUsers = await db.select().from(users).all();
  if (existingUsers.length === 0) {
    await db
      .insert(users)
      .values([
        {
          email: 'demo@example.com',
          name: 'Demo User',
          segment: 'growth',
        },
        {
          email: 'alice@example.com',
          name: 'Alice Johnson',
          segment: 'vip',
        },
        {
          email: 'ops@example.com',
          name: 'Ops Analyst',
          segment: 'internal',
        },
      ])
      .run();
    console.log('  🌱 Seeded users');
  }

  const existingSessions = await db.select().from(sessions).all();
  if (existingSessions.length === 0) {
    await db
      .insert(sessions)
      .values([
        { token: 'demo-token', userId: 1, scope: 'shop:read shop:write' },
        { token: 'alice-token', userId: 2, scope: 'shop:read shop:write' },
        { token: 'ops-token', userId: 3, scope: 'shop:read reports:read' },
      ])
      .run();
    console.log('  🌱 Seeded sessions');
  }

  const existingProducts = await db.select().from(products).all();
  if (existingProducts.length === 0) {
    await db
      .insert(products)
      .values([
        {
          name: 'Wireless Headphones',
          description: 'Noise-cancelling Bluetooth headphones',
          price: 149.99,
          category: 'electronics',
          stock: 45,
          featured: true,
        },
        {
          name: 'Mechanical Keyboard',
          description: 'Compact RGB keyboard with tactile switches',
          price: 129.99,
          category: 'electronics',
          stock: 30,
          featured: true,
        },
        {
          name: 'USB-C Hub',
          description: '7-in-1 USB-C hub with HDMI and Ethernet',
          price: 49.99,
          category: 'electronics',
          stock: 100,
          featured: false,
        },
        {
          name: 'Clean Code',
          description: 'A handbook of agile software craftsmanship',
          price: 39.99,
          category: 'books',
          stock: 75,
          featured: true,
        },
        {
          name: 'Design Patterns',
          description: 'Elements of reusable object-oriented software',
          price: 49.99,
          category: 'books',
          stock: 5,
          featured: false,
        },
        {
          name: 'Trail Running Shoes',
          description: 'Lightweight shoes built for all-weather paths',
          price: 119.99,
          category: 'clothing',
          stock: 8,
          featured: true,
        },
        {
          name: 'Merino Base Layer',
          description: 'Breathable merino long-sleeve layer',
          price: 74.99,
          category: 'clothing',
          stock: 16,
          featured: false,
        },
      ])
      .run();
    console.log('  🌱 Seeded products');
  }
}

function pipeOutput(child: ChildProcess, name: string): void {
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
}

function startService(
  name: string,
  entry: string,
  environment: Record<string, string>,
): ChildProcess {
  const child = spawn(
    pnpmCmd,
    ['exec', 'tsx', entry],
    {
      cwd: __dirname,
      env: {
        ...process.env,
        ...environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  pipeOutput(child, name);

  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      process.exitCode = code;
    }
  });

  return child;
}

const devtoolsPort = await pickPort(envPort('AUTOTEL_DEVTOOLS_PORT', 0));
const apiPort = await pickPort(envPort('API_PORT', 3000));
const authPort = await pickPort(envPort('AUTH_PORT', 3002));
const workerPort = await pickPort(envPort('WORKER_PORT', 3001));

const devtools = createDevtools({
  port: devtoolsPort,
  host: '127.0.0.1',
  verbose: true,
  maxTraceCount: 800,
  maxLogCount: 1200,
  maxMetricCount: 300,
});

const devtoolsUrl = `http://127.0.0.1:${devtools.port}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const authUrl = `http://127.0.0.1:${authPort}`;
const workerUrl = `http://127.0.0.1:${workerPort}`;

console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║      Autotel Devtools — Browser to Services Lab     ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');
console.log(`  🔍 Standalone dashboard → ${devtoolsUrl}`);
console.log(`  📦 Embedded widget      → ${devtoolsUrl}/widget.js`);
console.log(`  🌐 Shop web app         → ${apiUrl}`);
console.log('');

await seedDatabase();

const sharedEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL || 'file:./drizzle/dev.db',
  DEVTOOLS_URL: devtoolsUrl,
  BROWSER_SERVICE_NAME: 'shop-web',
  API_SERVICE_NAME: 'shop-api',
  AUTH_SERVICE_NAME: 'shop-auth',
  WORKER_SERVICE_NAME: 'shop-worker',
  AUTH_URL: authUrl,
  WORKER_URL: workerUrl,
};

const children = [
  startService('api', resolve(__dirname, 'src/api/server.ts'), {
    ...sharedEnvironment,
    API_PORT: String(apiPort),
  }),
  startService('auth', resolve(__dirname, 'src/auth/server.ts'), {
    ...sharedEnvironment,
    AUTH_PORT: String(authPort),
  }),
  startService('worker', resolve(__dirname, 'src/worker/server.ts'), {
    ...sharedEnvironment,
    WORKER_PORT: String(workerPort),
  }),
];

console.log('  Core trace paths to try:');
console.log('  1. Catalog   → browser → shop-api → sqlite');
console.log('  2. Profile   → browser → shop-api → shop-auth → sqlite');
console.log('  3. Checkout  → browser → shop-api → shop-auth → sqlite → shop-worker → sqlite');
console.log('  4. Report    → browser → shop-api → sqlite (slow recursive CTE)');
console.log('');
console.log('  Press Ctrl-C to stop all services.');
console.log('');

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n⏳ Shutting down showcase...');
  for (const child of children) {
    child.kill('SIGTERM');
  }

  await devtools.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
