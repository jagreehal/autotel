/**
 * OpenTelemetry semantic conventions for database operations.
 * These constants are shared across all plugins.
 */

// Common database attributes
export const SEMATTRS_DB_SYSTEM = 'db.system' as const;
export const SEMATTRS_DB_OPERATION = 'db.operation' as const;
export const SEMATTRS_DB_STATEMENT = 'db.statement' as const;
export const SEMATTRS_DB_NAME = 'db.name' as const;

// MongoDB-specific attributes
export const SEMATTRS_DB_MONGODB_COLLECTION = 'db.mongodb.collection' as const;

// Network attributes
export const SEMATTRS_NET_PEER_NAME = 'net.peer.name' as const;
export const SEMATTRS_NET_PEER_PORT = 'net.peer.port' as const;
