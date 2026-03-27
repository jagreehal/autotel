export interface WorkerEnv {
  // Config
  OTLP_ENDPOINT?: string;
  OTLP_HEADERS?: string;
  ENVIRONMENT?: string;
  DISABLE_INSTRUMENTATION?: string;

  // Bindings (all optional — endpoints check before use)
  MY_KV?: KVNamespace;
  MY_R2?: R2Bucket;
  MY_D1?: D1Database;
  MY_SERVICE?: Fetcher;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  MY_QUEUE?: Queue;
  AE?: AnalyticsEngineDataset;
}
