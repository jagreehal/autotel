import { URL } from 'node:url';

/**
 * Use an example-specific env var so this demo doesn't accidentally pick up
 * a developer's globally-set MONGO_URL (common in monorepos / other projects).
 */
export const mongoUrl =
  process.env.MONGOOSE_EXAMPLE_MONGO_URL ?? 'mongodb://localhost:27017/autotel-example';

export type MongoConnectionInfo = {
  dbName: string;
  peerName: string;
  peerPort: number;
};

export function getMongoConnectionInfo(urlString: string = mongoUrl): MongoConnectionInfo {
  const url = new URL(urlString);

  // URL.pathname includes a leading slash, e.g. "/autotel-example"
  const dbNameFromPath = url.pathname?.replace(/^\//, '')?.trim();
  const dbName = dbNameFromPath || 'autotel-example';

  const peerName = url.hostname || 'localhost';
  const peerPort = url.port ? Number.parseInt(url.port, 10) : 27017;

  return {
    dbName,
    peerName,
    peerPort: Number.isFinite(peerPort) ? peerPort : 27017,
  };
}

