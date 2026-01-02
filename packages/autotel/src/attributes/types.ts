/**
 * Type definitions for attribute builders
 */

export type PrimitiveValue = string | number | boolean;
export type ArrayValue = string[] | number[] | boolean[];

export interface UserAttrs {
  id?: string;
  email?: string;
  name?: string;
  fullName?: string;
  hash?: string;
  roles?: string[];
}

export interface SessionAttrs {
  id?: string;
  previousId?: string;
}

export interface DeviceAttrs {
  id?: string;
  manufacturer?: string;
  modelIdentifier?: string;
  modelName?: string;
}

export interface HTTPServerAttrs {
  method?: string;
  route?: string;
  statusCode?: number;
  bodySize?: number;
  requestSize?: number;
  responseSize?: number;
  resendCount?: number;
}

export interface HTTPClientAttrs {
  method?: string;
  url?: string;
  statusCode?: number;
}

export interface DBAttrs {
  system?: string;
  /** Database name - maps to db.namespace (db.name is deprecated) */
  name?: string;
  /** Explicit namespace - takes precedence over name if both provided */
  namespace?: string;
  operation?: string;
  collectionName?: string;
  statement?: string;
  querySummary?: string;
  queryText?: string;
  responseStatus?: string | number;
  rowsReturned?: number;
}

export interface ServiceAttrs {
  name?: string;
  instance?: string;
  version?: string;
}

export interface NetworkAttrs {
  protocolName?: string;
  protocolVersion?: string;
  peerAddress?: string;
  peerPort?: number;
  transport?: string;
  connectionId?: string;
}

export interface ErrorAttrs {
  type?: string;
  message?: string;
  stackTrace?: string;
  code?: string | number;
}

export interface FeatureFlagAttrs {
  key?: string;
  provider?: string;
  variant?: string;
}

export interface MessagingAttrs {
  system?: string;
  destination?: string;
  operation?: 'publish' | 'receive' | 'process';
  messageId?: string;
  conversationId?: string;
}

export interface CloudAttrs {
  provider?: string;
  accountId?: string;
  region?: string;
  availabilityZone?: string;
  platform?: string;
}

export interface ServerAddressAttrs {
  address?: string;
  port?: number;
  socketAddress?: string;
}

export interface URLAttrs {
  scheme?: string;
  full?: string;
  path?: string;
  query?: string;
  fragment?: string;
}

export interface PeerAttrs {
  service?: string;
  address?: string;
  port?: number;
}

export interface ProcessAttrs {
  pid?: number;
  executablePath?: string;
  command?: string;
  owner?: string;
}

export interface ContainerAttrs {
  id?: string;
  name?: string;
  image?: string;
  tag?: string;
}

export interface K8sAttrs {
  podName?: string;
  namespace?: string;
  deploymentName?: string;
  state?: string;
}

export interface FaaSAttrs {
  name?: string;
  version?: string;
  instance?: string;
  execution?: string;
  coldstart?: boolean;
}

export interface ThreadAttrs {
  id?: number;
  name?: string;
}

export interface GenAIAttrs {
  system?: string;
  requestModel?: string;
  responseModel?: string;
  operationName?: 'chat' | 'completion' | 'embedding';
  provider?: string;
}

export interface RPCAttrs {
  system?: string;
  service?: string;
  method?: string;
  message?: string;
}

export interface GraphQLAttrs {
  document?: string;
  operationName?: string;
  type?: 'query' | 'mutation' | 'subscription';
}

export interface ClientAttrs {
  address?: string;
  port?: number;
  socketAddress?: string;
}

export interface DeploymentAttrs {
  environment?: string;
  id?: string;
}

export interface OTelAttrs {
  libraryName?: string;
  libraryVersion?: string;
  schemaUrl?: string;
}

export interface CodeAttrs {
  namespace?: string;
  filepath?: string;
  function?: string;
  class?: string;
  method?: string;
  repository?: string;
  revision?: string;
}

export interface ExceptionAttrs {
  escaped?: boolean;
  message?: string;
  stackTrace?: string;
  type?: string;
  moduleName?: string;
}

export interface TLSAttrs {
  protocolVersion?: string;
  cipher?: string;
  curveName?: string;
  resumed?: boolean;
}
