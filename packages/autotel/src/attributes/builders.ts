/**
 * Attribute builders for constructing OpenTelemetry attributes
 * Provides both key builders (Pattern A) and object builders (Pattern B)
 *
 * @example Pattern A: Key builders
 * ```typescript
 * attrs.user.id('123')                              // { 'user.id': '123' }
 * attrs.user.email('user@example.com')                 // { 'user.email': 'user@example.com' }
 * attrs.http.request.method('GET')                   // { 'http.request.method': 'GET' }
 * attrs.http.response.statusCode(200)                 // { 'http.response.status_code': 200 }
 * ```
 *
 * @example Pattern B: Object builders
 * ```typescript
 * attrs.user({ id: '123', email: 'user@example.com' })
 * attrs.http.server({ method: 'GET', route: '/users/:id', statusCode: 200 })
 * attrs.db.client({ system: 'postgresql', operation: 'SELECT', collectionName: 'users' })
 * ```
 */

import {
  UserAttributes,
  SessionAttributes,
  DeviceAttributes,
  HTTPAttributes,
  DBAttributes,
  ServiceAttributes,
  NetworkAttributes,
  ServerAddressAttributes,
  URLAttributes,
  ErrorAttributes,
  ExceptionAttributes,
  ProcessAttributes,
  ThreadAttributes,
  ContainerAttributes,
  K8sAttributes,
  CloudAttributes,
  FaaSAttributes,
  FeatureFlagAttributes,
  MessagingAttributes,
  GenAIAttributes,
  RPCAttributes,
  GraphQLAttributes,
  OTelAttributes,
  CodeAttributes,
  TLSAttributes,
} from './registry';

import type {
  UserAttrs,
  SessionAttrs,
  DeviceAttrs,
  HTTPServerAttrs,
  HTTPClientAttrs,
  DBAttrs,
  ServiceAttrs,
  NetworkAttrs,
  ErrorAttrs,
  MessagingAttrs,
  CloudAttrs,
  ServerAddressAttrs,
  URLAttrs,
  ProcessAttrs,
  ContainerAttrs,
  ExceptionAttrs,
} from './types';

export const attrs = {
  user: {
    id: (value: string) => ({ [UserAttributes.id]: value }),
    email: (value: string) => ({ [UserAttributes.email]: value }),
    name: (value: string) => ({ [UserAttributes.name]: value }),
    fullName: (value: string) => ({ [UserAttributes.fullName]: value }),
    hash: (value: string) => ({ [UserAttributes.hash]: value }),
    roles: (value: string[]) => ({ [UserAttributes.roles]: value }),

    data: (data: UserAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.id !== undefined) result[UserAttributes.id] = data.id;
      if (data.email !== undefined) result[UserAttributes.email] = data.email;
      if (data.name !== undefined) result[UserAttributes.name] = data.name;
      if (data.fullName !== undefined)
        result[UserAttributes.fullName] = data.fullName;
      if (data.hash !== undefined) result[UserAttributes.hash] = data.hash;
      if (data.roles !== undefined) result[UserAttributes.roles] = data.roles;
      return result;
    },
  },

  session: {
    id: (value: string) => ({ [SessionAttributes.id]: value }),
    previousId: (value: string) => ({ [SessionAttributes.previousId]: value }),

    data: (data: SessionAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.id !== undefined) result[SessionAttributes.id] = data.id;
      if (data.previousId !== undefined)
        result[SessionAttributes.previousId] = data.previousId;
      return result;
    },
  },

  device: {
    id: (value: string) => ({ [DeviceAttributes.id]: value }),
    manufacturer: (value: string) => ({
      [DeviceAttributes.manufacturer]: value,
    }),
    modelIdentifier: (value: string) => ({
      [DeviceAttributes.modelIdentifier]: value,
    }),
    modelName: (value: string) => ({ [DeviceAttributes.modelName]: value }),

    data: (data: DeviceAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.id !== undefined) result[DeviceAttributes.id] = data.id;
      if (data.manufacturer !== undefined)
        result[DeviceAttributes.manufacturer] = data.manufacturer;
      if (data.modelIdentifier !== undefined)
        result[DeviceAttributes.modelIdentifier] = data.modelIdentifier;
      if (data.modelName !== undefined)
        result[DeviceAttributes.modelName] = data.modelName;
      return result;
    },
  },

  http: {
    request: {
      method: (value: string) => ({ [HTTPAttributes.requestMethod]: value }),
      methodOriginal: (value: string) => ({
        [HTTPAttributes.requestMethodOriginal]: value,
      }),
      resendCount: (value: number) => ({
        [HTTPAttributes.requestResendCount]: value,
      }),
      size: (value: number) => ({ [HTTPAttributes.requestSize]: value }),
      bodySize: (value: number) => ({
        [HTTPAttributes.requestBodySize]: value,
      }),
    },

    response: {
      statusCode: (value: number) => ({
        [HTTPAttributes.responseStatusCode]: value,
      }),
      size: (value: number) => ({ [HTTPAttributes.responseSize]: value }),
      bodySize: (value: number) => ({
        [HTTPAttributes.responseBodySize]: value,
      }),
    },

    route: (value: string) => ({ [HTTPAttributes.route]: value }),
    connectionState: (value: string) => ({
      [HTTPAttributes.connectionState]: value,
    }),

    server: (data: HTTPServerAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.method !== undefined)
        result[HTTPAttributes.requestMethod] = data.method;
      if (data.route !== undefined) result[HTTPAttributes.route] = data.route;
      if (data.statusCode !== undefined)
        result[HTTPAttributes.responseStatusCode] = data.statusCode;
      if (data.bodySize !== undefined)
        result[HTTPAttributes.requestBodySize] = data.bodySize;
      if (data.requestSize !== undefined)
        result[HTTPAttributes.requestSize] = data.requestSize;
      if (data.responseSize !== undefined)
        result[HTTPAttributes.responseSize] = data.responseSize;
      if (data.resendCount !== undefined)
        result[HTTPAttributes.requestResendCount] = data.resendCount;
      return result;
    },

    client: (data: HTTPClientAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.method !== undefined)
        result[HTTPAttributes.requestMethod] = data.method;
      if (data.url !== undefined) result[HTTPAttributes.route] = data.url;
      if (data.statusCode !== undefined)
        result[HTTPAttributes.responseStatusCode] = data.statusCode;
      return result;
    },
  },

  db: {
    client: {
      system: (value: string) => ({ [DBAttributes.systemName]: value }),
      operation: (value: string) => ({ [DBAttributes.operationName]: value }),
      collectionName: (value: string) => ({
        [DBAttributes.collectionName]: value,
      }),
      namespace: (value: string) => ({ [DBAttributes.namespace]: value }),
      statement: (value: string) => ({ [DBAttributes.statement]: value }),
      querySummary: (value: string) => ({ [DBAttributes.querySummary]: value }),
      queryText: (value: string) => ({ [DBAttributes.queryText]: value }),
      responseStatus: (value: string | number) => ({
        [DBAttributes.responseStatusCode]: value,
      }),
      rowsReturned: (value: number) => ({
        [DBAttributes.responseReturnedRows]: value,
      }),

      data: (data: DBAttrs) => {
        const result: Record<string, unknown> = {};
        if (data.system !== undefined)
          result[DBAttributes.systemName] = data.system;
        if (data.operation !== undefined)
          result[DBAttributes.operationName] = data.operation;
        if (data.collectionName !== undefined)
          result[DBAttributes.collectionName] = data.collectionName;
        // 'name' maps to db.namespace (db.name is deprecated per OTel semantic conventions)
        if (data.name !== undefined) result[DBAttributes.namespace] = data.name;
        // 'namespace' takes precedence over 'name' if both are provided
        if (data.namespace !== undefined)
          result[DBAttributes.namespace] = data.namespace;
        if (data.statement !== undefined)
          result[DBAttributes.statement] = data.statement;
        if (data.querySummary !== undefined)
          result[DBAttributes.querySummary] = data.querySummary;
        if (data.queryText !== undefined)
          result[DBAttributes.queryText] = data.queryText;
        if (data.responseStatus !== undefined)
          result[DBAttributes.responseStatusCode] = data.responseStatus;
        if (data.rowsReturned !== undefined)
          result[DBAttributes.responseReturnedRows] = data.rowsReturned;
        return result;
      },
    },
  },

  service: {
    name: (value: string) => ({ [ServiceAttributes.name]: value }),
    instance: (value: string) => ({ [ServiceAttributes.instance]: value }),
    version: (value: string) => ({ [ServiceAttributes.version]: value }),

    data: (data: ServiceAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.name !== undefined) result[ServiceAttributes.name] = data.name;
      if (data.instance !== undefined)
        result[ServiceAttributes.instance] = data.instance;
      if (data.version !== undefined)
        result[ServiceAttributes.version] = data.version;
      return result;
    },
  },

  network: {
    peerAddress: (value: string) => ({
      [NetworkAttributes.peerAddress]: value,
    }),
    peerPort: (value: number) => ({ [NetworkAttributes.peerPort]: value }),
    transport: (value: string) => ({ [NetworkAttributes.transport]: value }),
    protocolName: (value: string) => ({
      [NetworkAttributes.protocolName]: value,
    }),
    protocolVersion: (value: string) => ({
      [NetworkAttributes.protocolVersion]: value,
    }),

    data: (data: NetworkAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.peerAddress !== undefined)
        result[NetworkAttributes.peerAddress] = data.peerAddress;
      if (data.peerPort !== undefined)
        result[NetworkAttributes.peerPort] = data.peerPort;
      if (data.transport !== undefined)
        result[NetworkAttributes.transport] = data.transport;
      if (data.protocolName !== undefined)
        result[NetworkAttributes.protocolName] = data.protocolName;
      if (data.protocolVersion !== undefined)
        result[NetworkAttributes.protocolVersion] = data.protocolVersion;
      return result;
    },
  },

  server: {
    address: (value: string) => ({ [ServerAddressAttributes.address]: value }),
    port: (value: number) => ({ [ServerAddressAttributes.port]: value }),
    socketAddress: (value: string) => ({
      [ServerAddressAttributes.socketAddress]: value,
    }),

    data: (data: ServerAddressAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.address !== undefined)
        result[ServerAddressAttributes.address] = data.address;
      if (data.port !== undefined)
        result[ServerAddressAttributes.port] = data.port;
      if (data.socketAddress !== undefined)
        result[ServerAddressAttributes.socketAddress] = data.socketAddress;
      return result;
    },
  },

  url: {
    scheme: (value: string) => ({ [URLAttributes.scheme]: value }),
    full: (value: string) => ({ [URLAttributes.full]: value }),
    path: (value: string) => ({ [URLAttributes.path]: value }),
    query: (value: string) => ({ [URLAttributes.query]: value }),
    fragment: (value: string) => ({ [URLAttributes.fragment]: value }),

    data: (data: URLAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.scheme !== undefined) result[URLAttributes.scheme] = data.scheme;
      if (data.full !== undefined) result[URLAttributes.full] = data.full;
      if (data.path !== undefined) result[URLAttributes.path] = data.path;
      if (data.query !== undefined) result[URLAttributes.query] = data.query;
      if (data.fragment !== undefined)
        result[URLAttributes.fragment] = data.fragment;
      return result;
    },
  },

  error: {
    type: (value: string) => ({ [ErrorAttributes.type]: value }),
    message: (value: string) => ({ [ErrorAttributes.message]: value }),
    stackTrace: (value: string) => ({ [ErrorAttributes.stackTrace]: value }),
    code: (value: string | number) => ({ [ErrorAttributes.code]: value }),

    data: (data: ErrorAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.type !== undefined) result[ErrorAttributes.type] = data.type;
      if (data.message !== undefined)
        result[ErrorAttributes.message] = data.message;
      if (data.stackTrace !== undefined)
        result[ErrorAttributes.stackTrace] = data.stackTrace;
      if (data.code !== undefined) result[ErrorAttributes.code] = data.code;
      return result;
    },
  },

  exception: {
    escaped: (value: boolean) => ({ [ExceptionAttributes.escaped]: value }),
    message: (value: string) => ({ [ExceptionAttributes.message]: value }),
    stackTrace: (value: string) => ({
      [ExceptionAttributes.stackTrace]: value,
    }),
    type: (value: string) => ({ [ExceptionAttributes.type]: value }),
    moduleName: (value: string) => ({
      [ExceptionAttributes.moduleName]: value,
    }),

    data: (data: ExceptionAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.escaped !== undefined)
        result[ExceptionAttributes.escaped] = data.escaped;
      if (data.message !== undefined)
        result[ExceptionAttributes.message] = data.message;
      if (data.stackTrace !== undefined)
        result[ExceptionAttributes.stackTrace] = data.stackTrace;
      if (data.type !== undefined) result[ExceptionAttributes.type] = data.type;
      if (data.moduleName !== undefined)
        result[ExceptionAttributes.moduleName] = data.moduleName;
      return result;
    },
  },

  process: {
    pid: (value: number) => ({ [ProcessAttributes.pid]: value }),
    executablePath: (value: string) => ({
      [ProcessAttributes.executablePath]: value,
    }),
    command: (value: string) => ({ [ProcessAttributes.command]: value }),
    owner: (value: string) => ({ [ProcessAttributes.owner]: value }),

    data: (data: ProcessAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.pid !== undefined) result[ProcessAttributes.pid] = data.pid;
      if (data.executablePath !== undefined)
        result[ProcessAttributes.executablePath] = data.executablePath;
      if (data.command !== undefined)
        result[ProcessAttributes.command] = data.command;
      if (data.owner !== undefined)
        result[ProcessAttributes.owner] = data.owner;
      return result;
    },
  },

  thread: {
    id: (value: number) => ({ [ThreadAttributes.id]: value }),
    name: (value: string) => ({ [ThreadAttributes.name]: value }),
  },

  container: {
    id: (value: string) => ({ [ContainerAttributes.id]: value }),
    name: (value: string) => ({ [ContainerAttributes.name]: value }),
    image: (value: string) => ({ [ContainerAttributes.image]: value }),
    tag: (value: string) => ({ [ContainerAttributes.tag]: value }),

    data: (data: ContainerAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.id !== undefined) result[ContainerAttributes.id] = data.id;
      if (data.name !== undefined) result[ContainerAttributes.name] = data.name;
      if (data.image !== undefined)
        result[ContainerAttributes.image] = data.image;
      if (data.tag !== undefined) result[ContainerAttributes.tag] = data.tag;
      return result;
    },
  },

  k8s: {
    podName: (value: string) => ({ [K8sAttributes.podName]: value }),
    namespaceName: (value: string) => ({
      [K8sAttributes.namespaceName]: value,
    }),
    deploymentName: (value: string) => ({
      [K8sAttributes.deploymentName]: value,
    }),
    state: (value: string) => ({ [K8sAttributes.state]: value }),
  },

  cloud: {
    provider: (value: string) => ({ [CloudAttributes.provider]: value }),
    accountId: (value: string) => ({ [CloudAttributes.accountId]: value }),
    region: (value: string) => ({ [CloudAttributes.region]: value }),
    availabilityZone: (value: string) => ({
      [CloudAttributes.availabilityZone]: value,
    }),
    platform: (value: string) => ({ [CloudAttributes.platform]: value }),

    data: (data: CloudAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.provider !== undefined)
        result[CloudAttributes.provider] = data.provider;
      if (data.accountId !== undefined)
        result[CloudAttributes.accountId] = data.accountId;
      if (data.region !== undefined)
        result[CloudAttributes.region] = data.region;
      if (data.availabilityZone !== undefined)
        result[CloudAttributes.availabilityZone] = data.availabilityZone;
      if (data.platform !== undefined)
        result[CloudAttributes.platform] = data.platform;
      return result;
    },
  },

  faas: {
    name: (value: string) => ({ [FaaSAttributes.name]: value }),
    version: (value: string) => ({ [FaaSAttributes.version]: value }),
    instance: (value: string) => ({ [FaaSAttributes.instance]: value }),
    execution: (value: string) => ({ [FaaSAttributes.execution]: value }),
    coldstart: (value: boolean) => ({ [FaaSAttributes.coldstart]: value }),
  },

  featureFlag: {
    key: (value: string) => ({ [FeatureFlagAttributes.key]: value }),
    provider: (value: string) => ({ [FeatureFlagAttributes.provider]: value }),
    variant: (value: string) => ({ [FeatureFlagAttributes.variant]: value }),
  },

  messaging: {
    system: (value: string) => ({ [MessagingAttributes.system]: value }),
    destination: (value: string) => ({
      [MessagingAttributes.destination]: value,
    }),
    operation: (value: 'publish' | 'receive' | 'process') => ({
      [MessagingAttributes.operation]: value,
    }),
    messageId: (value: string) => ({ [MessagingAttributes.messageId]: value }),
    conversationId: (value: string) => ({
      [MessagingAttributes.conversationId]: value,
    }),

    data: (data: MessagingAttrs) => {
      const result: Record<string, unknown> = {};
      if (data.system !== undefined)
        result[MessagingAttributes.system] = data.system;
      if (data.destination !== undefined)
        result[MessagingAttributes.destination] = data.destination;
      if (data.operation !== undefined)
        result[MessagingAttributes.operation] = data.operation;
      if (data.messageId !== undefined)
        result[MessagingAttributes.messageId] = data.messageId;
      if (data.conversationId !== undefined)
        result[MessagingAttributes.conversationId] = data.conversationId;
      return result;
    },
  },

  genAI: {
    system: (value: string) => ({ [GenAIAttributes.system]: value }),
    requestModel: (value: string) => ({
      [GenAIAttributes.requestModel]: value,
    }),
    responseModel: (value: string) => ({
      [GenAIAttributes.responseModel]: value,
    }),
    operationName: (value: 'chat' | 'completion' | 'embedding') => ({
      [GenAIAttributes.operationName]: value,
    }),
    usagePromptTokens: (value: number) => ({
      [GenAIAttributes.usagePromptTokens]: value,
    }),
    usageCompletionTokens: (value: number) => ({
      [GenAIAttributes.usageCompletionTokens]: value,
    }),
    provider: (value: string) => ({ [GenAIAttributes.provider]: value }),
  },

  rpc: {
    system: (value: string) => ({ [RPCAttributes.system]: value }),
    service: (value: string) => ({ [RPCAttributes.service]: value }),
    method: (value: string) => ({ [RPCAttributes.method]: value }),
    grpcStatusCode: (value: number) => ({
      [RPCAttributes.grpcStatusCode]: value,
    }),
  },

  graphql: {
    document: (value: string) => ({ [GraphQLAttributes.document]: value }),
    operationName: (value: string) => ({
      [GraphQLAttributes.operationName]: value,
    }),
    operationType: (value: 'query' | 'mutation' | 'subscription') => ({
      [GraphQLAttributes.operationType]: value,
    }),
  },

  otel: {
    libraryName: (value: string) => ({ [OTelAttributes.libraryName]: value }),
    libraryVersion: (value: string) => ({
      [OTelAttributes.libraryVersion]: value,
    }),
    statusCode: (value: string) => ({ [OTelAttributes.statusCode]: value }),
  },

  code: {
    namespace: (value: string) => ({ [CodeAttributes.namespace]: value }),
    filepath: (value: string) => ({ [CodeAttributes.filepath]: value }),
    function: (value: string) => ({ [CodeAttributes.function]: value }),
    class: (value: string) => ({ [CodeAttributes.class]: value }),
    method: (value: string) => ({ [CodeAttributes.method]: value }),
    column: (value: string) => ({ [CodeAttributes.column]: value }),
    lineNumber: (value: number) => ({ [CodeAttributes.lineNumber]: value }),
    repository: (value: string) => ({ [CodeAttributes.repository]: value }),
    revision: (value: string) => ({ [CodeAttributes.revision]: value }),
  },

  tls: {
    protocolVersion: (value: string) => ({
      [TLSAttributes.protocolVersion]: value,
    }),
    cipher: (value: string) => ({ [TLSAttributes.cipher]: value }),
    curveName: (value: string) => ({ [TLSAttributes.curveName]: value }),
    resumed: (value: boolean) => ({ [TLSAttributes.resumed]: value }),
  },
} as const;
