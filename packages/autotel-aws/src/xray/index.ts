/**
 * X-Ray compatibility utilities
 *
 * @example
 * ```typescript
 * import { configureXRay, setXRayAnnotation } from 'autotel-aws/xray';
 *
 * configureXRay({
 *   propagator: true,
 *   remoteSampling: true,
 *   idGenerator: true
 * });
 *
 * setXRayAnnotation('user.id', userId);
 * ```
 */

export { configureXRay, setXRayAnnotation, setXRayMetadata } from './annotations';
export { XRayPropagator } from './propagator';
export type { XRayConfig } from '../config';
