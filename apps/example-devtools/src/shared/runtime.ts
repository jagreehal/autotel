import { createServer } from 'node:net';

export interface ShowcasePorts {
  api: number;
  auth: number;
  worker: number;
  devtools: number;
}

async function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function allocatePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate an ephemeral port.')));
        return;
      }

      const { port } = address;
      server.close(() => resolve(port));
    });
    server.listen(preferred);
  });
}

export async function pickPort(
  preferred: number,
): Promise<number> {
  if (preferred === 0) {
    return allocatePort(0);
  }

  if (await canListen(preferred)) return preferred;

  for (let candidate = preferred + 1; candidate < preferred + 25; candidate += 1) {
    if (await canListen(candidate)) return candidate;
  }

  throw new Error(
    `Unable to find a free port near ${preferred}.`,
  );
}

export function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
