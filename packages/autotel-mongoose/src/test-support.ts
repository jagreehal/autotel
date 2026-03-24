import { createServer } from 'node:http';

export async function canListenOnLoopback(): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', (error) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EPERM'
      ) {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(true);
      });
    });
  });
}
