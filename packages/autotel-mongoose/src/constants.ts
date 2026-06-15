// Stable OTel semantic conventions only — no deprecated attributes.

export const ATTR_DB_QUERY_TEXT = 'db.query.text' as const;
export const ATTR_DB_OPERATION_NAME = 'db.operation.name' as const;
export const ATTR_DB_SYSTEM_NAME = 'db.system.name' as const;
export const ATTR_DB_COLLECTION_NAME = 'db.collection.name' as const;
export const ATTR_DB_NAMESPACE = 'db.namespace' as const;
export const ATTR_SERVER_ADDRESS = 'server.address' as const;
export const ATTR_SERVER_PORT = 'server.port' as const;

// Stable code semconv — used for user-defined statics/methods/query helpers.
export const ATTR_CODE_FUNCTION_NAME = 'code.function.name' as const;

// Autotel-namespaced attributes for user-defined Mongoose functions.
// Mirrors the existing `hook.*` namespace used for schema hook spans.
export const ATTR_MONGOOSE_METHOD_NAME = 'mongoose.method.name' as const;
/** One of: "static" | "instance" | "query". */
export const ATTR_MONGOOSE_METHOD_TYPE = 'mongoose.method.type' as const;
export const ATTR_MONGOOSE_METHOD_MODEL = 'mongoose.method.model' as const;
export const ATTR_MONGOOSE_METHOD_PARAMETERS =
  'mongoose.method.parameters' as const;
export const ATTR_MONGOOSE_METHOD_PARAMETER_COUNT =
  'mongoose.method.parameter_count' as const;

export const DB_SYSTEM_NAME_VALUE_MONGODB = 'mongodb' as const;
