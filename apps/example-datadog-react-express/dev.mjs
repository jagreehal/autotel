// Starts the API and the Vite dev server together; Ctrl-C stops both.
import { spawn } from 'node:child_process';

const run = (script) =>
  spawn('pnpm', ['run', script], { stdio: 'inherit', shell: false });
const children = [run('api'), run('web')];
const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && stop());
