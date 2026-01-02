/**
 * Type-safe OpenTelemetry attribute builders and utilities
 *
 * Provides autocomplete-first attribute construction, automatic PII redaction,
 * and deprecation warnings for semantic attributes.
 *
 * @example Pattern A: Object builders
 * ```typescript
 * import { attrs, setUser } from 'autotel/attributes'
 *
 * setUser(span, {
 *   user: { id: '123', email: 'user@example.com' },
 *   session: { id: 'sess-1' }
 * })
 * ```
 *
 * @example Pattern B: Key builders
 * ```typescript
 * import { attrs, setUser } from 'autotel/attributes'
 *
 * ctx.setAttributes(attrs.user.id('123'))
 * ctx.setAttributes(attrs.session.id('sess-1'))
 * ctx.setAttributes(attrs.http.request.method('GET'))
 * ```
 */

export { attrs } from './builders';
export {
  setUser,
  setSession,
  setDevice,
  httpServer,
  httpClient,
  dbClient,
  mergeServiceResource,
  identify,
  request,
  setError,
  setException,
} from './attachers';
export { transaction } from './domains';
export { mergeAttrs, safeSetAttributes } from './utils';
export {
  validateAttribute,
  checkDeprecatedAttribute,
  autoRedactPII,
  defaultGuardrails,
  type AttributeGuardrails,
  type AttributePolicy,
} from './validators';

export type {
  UserAttrs,
  SessionAttrs,
  DeviceAttrs,
  HTTPServerAttrs,
  HTTPClientAttrs,
  DBAttrs,
  ServiceAttrs,
  NetworkAttrs,
  ErrorAttrs,
  FeatureFlagAttrs,
  MessagingAttrs,
  CloudAttrs,
  ServerAddressAttrs,
  URLAttrs,
  PeerAttrs,
  ProcessAttrs,
  ContainerAttrs,
  K8sAttrs,
  FaaSAttrs,
  ThreadAttrs,
  GenAIAttrs,
  RPCAttrs,
  GraphQLAttrs,
  ClientAttrs,
  DeploymentAttrs,
  OTelAttrs,
  CodeAttrs,
  ExceptionAttrs,
  TLSAttrs,
} from './types';
