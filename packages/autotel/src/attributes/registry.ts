/**
 * OpenTelemetry attribute registry
 * Central source of truth for attribute keys, types, and metadata
 */

export const UserAttributes = {
  id: 'user.id' as const,
  email: 'user.email' as const,
  name: 'user.name' as const,
  fullName: 'user.full_name' as const,
  hash: 'user.hash' as const,
  roles: 'user.roles' as const,
} as const;

export const SessionAttributes = {
  id: 'session.id' as const,
  previousId: 'session.previous_id' as const,
} as const;

export const DeviceAttributes = {
  id: 'device.id' as const,
  manufacturer: 'device.manufacturer' as const,
  modelIdentifier: 'device.model.identifier' as const,
  modelName: 'device.model.name' as const,
} as const;

export const HTTPAttributes = {
  connectionState: 'http.connection.state' as const,
  requestMethod: 'http.request.method' as const,
  requestMethodOriginal: 'http.request.method_original' as const,
  requestResendCount: 'http.request.resend_count' as const,
  requestSize: 'http.request.size' as const,
  requestBodySize: 'http.request.body.size' as const,
  responseSize: 'http.response.size' as const,
  responseBodySize: 'http.response.body.size' as const,
  responseStatusCode: 'http.response.status_code' as const,
  route: 'http.route' as const,
} as const;

export const DBAttributes = {
  clientConnectionPoolName: 'db.client.connection.pool.name' as const,
  clientConnectionState: 'db.client.connection.state' as const,
  collectionName: 'db.collection.name' as const,
  namespace: 'db.namespace' as const,
  operationBatchSize: 'db.operation.batch.size' as const,
  operationName: 'db.operation.name' as const,
  querySummary: 'db.query.summary' as const,
  queryText: 'db.query.text' as const,
  responseReturnedRows: 'db.response.returned_rows' as const,
  responseStatusCode: 'db.response.status_code' as const,
  systemName: 'db.system.name' as const,
  statement: 'db.statement' as const,
} as const;

export const ServiceAttributes = {
  name: 'service.name' as const,
  instance: 'service.instance.id' as const,
  version: 'service.version' as const,
} as const;

export const NetworkAttributes = {
  peerAddress: 'network.peer.address' as const,
  peerPort: 'network.peer.port' as const,
  transport: 'network.transport' as const,
  type: 'network.type' as const,
  protocolName: 'network.protocol.name' as const,
  protocolVersion: 'network.protocol.version' as const,
} as const;

export const ServerAddressAttributes = {
  address: 'server.address' as const,
  port: 'server.port' as const,
  socketAddress: 'server.socket.address' as const,
} as const;

export const URLAttributes = {
  scheme: 'url.scheme' as const,
  full: 'url.full' as const,
  path: 'url.path' as const,
  query: 'url.query' as const,
  fragment: 'url.fragment' as const,
} as const;

export const ErrorAttributes = {
  type: 'error.type' as const,
  message: 'error.message' as const,
  stackTrace: 'error.stack' as const,
  code: 'error.code' as const,
} as const;

export const ExceptionAttributes = {
  escaped: 'exception.escaped' as const,
  message: 'exception.message' as const,
  stackTrace: 'exception.stacktrace' as const,
  type: 'exception.type' as const,
  moduleName: 'exception.module' as const,
} as const;

export const ProcessAttributes = {
  pid: 'process.pid' as const,
  executablePath: 'process.executable.path' as const,
  command: 'process.command' as const,
  owner: 'process.owner' as const,
  commandArgs: 'process.command_args' as const,
} as const;

export const ThreadAttributes = {
  id: 'thread.id' as const,
  name: 'thread.name' as const,
} as const;

export const ContainerAttributes = {
  id: 'container.id' as const,
  name: 'container.name' as const,
  image: 'container.image.name' as const,
  tag: 'container.image.tag' as const,
} as const;

export const K8sAttributes = {
  podName: 'k8s.pod.name' as const,
  namespaceName: 'k8s.namespace.name' as const,
  deploymentName: 'k8s.deployment.name' as const,
  state: 'k8s.state.name' as const,
} as const;

export const CloudAttributes = {
  provider: 'cloud.provider' as const,
  accountId: 'cloud.account.id' as const,
  region: 'cloud.region' as const,
  availabilityZone: 'cloud.availability_zone' as const,
  platform: 'cloud.platform' as const,
} as const;

export const FaaSAttributes = {
  name: 'faas.name' as const,
  version: 'faas.version' as const,
  instance: 'faas.instance' as const,
  execution: 'faas.execution' as const,
  coldstart: 'faas.coldstart' as const,
} as const;

export const FeatureFlagAttributes = {
  key: 'feature.flag.key' as const,
  provider: 'feature.flag.provider_name' as const,
  variant: 'feature.flag.variant.name' as const,
} as const;

export const MessagingAttributes = {
  system: 'messaging.system' as const,
  destination: 'messaging.destination.name' as const,
  operation: 'messaging.operation' as const,
  messageId: 'messaging.message.id' as const,
  conversationId: 'messaging.conversation_id' as const,
  batchMessageCount: 'messaging.batch.message_count' as const,
  consumerGroup: 'messaging.consumer.group' as const,
} as const;

export const GenAIAttributes = {
  system: 'gen.ai.system' as const,
  requestModel: 'gen.ai.request.model' as const,
  responseModel: 'gen.ai.response.model' as const,
  operationName: 'gen.ai.operation.name' as const,
  usagePromptTokens: 'gen.ai.usage.prompt_tokens' as const,
  usageCompletionTokens: 'gen.ai.usage.completion_tokens' as const,
  provider: 'gen.ai.provider' as const,
} as const;

export const RPCAttributes = {
  system: 'rpc.system' as const,
  service: 'rpc.service' as const,
  method: 'rpc.method' as const,
  grpcStatusCode: 'rpc.grpc.status_code' as const,
} as const;

export const GraphQLAttributes = {
  document: 'graphql.document' as const,
  operationName: 'graphql.operation.name' as const,
  operationType: 'graphql.operation.type' as const,
} as const;

export const PeerAttributes = {
  service: 'peer.service' as const,
} as const;

export const ClientAttributes = {
  address: 'client.address' as const,
  port: 'client.port' as const,
  socketAddress: 'client.socket.address' as const,
} as const;

export const DeploymentAttributes = {
  environment: 'deployment.environment' as const,
  id: 'deployment.environment.id' as const,
} as const;

export const OTelAttributes = {
  libraryName: 'otel.library.name' as const,
  libraryVersion: 'otel.library.version' as const,
  statusCode: 'otel.status_code' as const,
} as const;

export const CodeAttributes = {
  namespace: 'code.namespace' as const,
  filepath: 'code.filepath' as const,
  function: 'code.function' as const,
  class: 'code.class' as const,
  method: 'code.method' as const,
  column: 'code.column' as const,
  lineNumber: 'code.lineno' as const,
  repository: 'code.repository' as const,
  revision: 'code.revision' as const,
} as const;

export const TLSAttributes = {
  protocolVersion: 'tls.protocol.version' as const,
  cipher: 'tls.cipher' as const,
  curveName: 'tls.curve.name' as const,
  resumed: 'tls.resumed' as const,
} as const;

export const BrowserAttributes = {
  platform: 'browser.platform' as const,
  language: 'browser.language' as const,
  brand: 'browser.brand' as const,
  mobile: 'browser.mobile' as const,
} as const;

export const AndroidAttributes = {
  appVersion: 'android.app.version' as const,
  package: 'android.package' as const,
  activityName: 'android.activity.name' as const,
} as const;

export const IOSAttributes = {
  deviceModel: 'ios.device.model' as const,
  version: 'ios.version' as const,
} as const;

export const GeoAttributes = {
  cityName: 'geo.city.name' as const,
  countryCode: 'geo.country.name' as const,
  continentCode: 'geo.continent.code' as const,
} as const;

export const UserAgentAttributes = {
  original: 'user_agent.original' as const,
} as const;

export const AWSAttributes = {
  ecsClusterArn: 'aws.ecs.cluster.arn' as const,
  ecsContainerArn: 'aws.ecs.container.arn' as const,
  logGroupName: 'aws.log.group.name' as const,
  requestId: 'aws.requestId' as const,
} as const;

export const AzureAttributes = {
  subscriptionId: 'azure.subscription.id' as const,
  tenantId: 'azure.tenant.id' as const,
} as const;

export const GCPAttributes = {
  project: 'gcp.project.id' as const,
  instanceName: 'gcp.instance.name' as const,
  zone: 'gcp.zone' as const,
} as const;

export const CassandraAttributes = {
  consistencyLevel: 'cassandra.consistency.level' as const,
  coordinatorId: 'cassandra.coordinator.id' as const,
  dataCenter: 'cassandra.coordinator.dc' as const,
  pageSize: 'cassandra.page.size' as const,
} as const;

export const ElasticsearchAttributes = {
  clusterName: 'elasticsearch.cluster.name' as const,
  nodeId: 'elasticsearch.node.name' as const,
} as const;

export const MongoDBAttributes = {
  collectionName: 'mongodb.collection.name' as const,
} as const;

export const RedisAttributes = {
  databaseIndex: 'redis.database.index' as const,
} as const;

export const MSSQLAttributes = {
  instanceName: 'mssql.instance.name' as const,
} as const;

export const PostgreSQLAttributes = {
  databaseName: 'postgresql.database.name' as const,
} as const;

export const AWSLambdaAttributes = {
  requestId: 'aws.lambda.invoked_arn' as const,
  requestFunction: 'aws.lambda.invoked_function_arn' as const,
} as const;

export const OpenAIAttributes = {
  requestId: 'openai.request.id' as const,
  responseModel: 'openai.response.model' as const,
  responseOrganization: 'openai.response.organization' as const,
} as const;

export const AzureAIAAttributes = {
  resource: 'azure.ai.inference.resource' as const,
  deploymentId: 'azure.ai.inference.deployment.id' as const,
} as const;

export const AWSBedrockAttributes = {
  requestId: 'aws.bedrock.requestId' as const,
  responseModel: 'aws.bedrock.responseModel' as const,
} as const;

export const TestAttributes = {
  framework: 'test.framework' as const,
  name: 'test.name' as const,
} as const;

export const ArtifactAttributes = {
  type: 'artifact.type' as const,
  id: 'artifact.id' as const,
  checksum: 'artifact.checksum' as const,
} as const;

export const CICDAttributes = {
  pipelineName: 'ci.pipeline.name' as const,
  pipelineRunId: 'ci.pipeline.run.id' as const,
} as const;
