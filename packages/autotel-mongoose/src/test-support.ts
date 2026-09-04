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

/** A MongoDB the integration tests can talk to, and the way to let it go. */
export interface TestMongo {
  uri: string;
  stop: () => Promise<void>;
}

/**
 * The MongoDB to run integration tests against.
 *
 * `MONGO_TEST_URI` points the suite at a server that is already running: a
 * container in CI, or one on a developer's machine
 * (`MONGO_TEST_URI=mongodb://127.0.0.1:27017 pnpm test:integration`). Without
 * it, an in-memory server is downloaded and started per file, which keeps the
 * suite self-contained but says nothing about a real deployment.
 *
 * Each caller gets its own database name so files sharing a server cannot
 * collide.
 */
export async function startMongo(dbName: string): Promise<TestMongo> {
  const provided = process.env.MONGO_TEST_URI;
  if (provided) {
    // A shared server keeps whatever the last run left behind, and tests that
    // count documents or spans would read those too. A database per run gives
    // each file the empty server the in-memory one provides, and it is dropped
    // on the way out so a developer's MongoDB does not collect them.
    const database = `${dbName}_${Math.random().toString(36).slice(2, 10)}`;
    const uri = new URL(provided);
    uri.pathname = `/${database}`;
    const address = uri.toString();

    return {
      uri: address,
      stop: async () => {
        const mongoose = await import('mongoose');
        const connection = await mongoose.default
          .createConnection(address)
          .asPromise();
        await connection.dropDatabase();
        await connection.close();
      },
    };
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  return {
    uri: server.getUri(dbName),
    stop: async () => {
      await server.stop();
    },
  };
}
