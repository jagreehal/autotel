import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

function canListen() {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        resolve(false);
        return;
      }

      resolve(error);
    });

    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

const listenResult = await canListen();

if (listenResult === false) {
  console.log('Skipping Playwright E2E tests: this environment does not allow opening local TCP ports.');
  process.exit(0);
}

if (listenResult instanceof Error) {
  throw listenResult;
}

const child = spawn('pnpm', ['exec', 'playwright', 'test'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
