/**
 * X-Ray annotation and metadata helpers
 */

import { trace } from '@opentelemetry/api';
import { AWS_ATTRS } from '../attributes';
import type { XRayConfig } from '../config';

let xrayConfig: XRayConfig = {};

/**
 * Configure X-Ray compatibility features
 */
export function configureXRay(config: XRayConfig): void {
  xrayConfig = { ...xrayConfig, ...config };
}

/**
 * Set X-Ray annotation (indexed in X-Ray console)
 *
 * Annotations are indexed and can be used for filtering in X-Ray.
 * They are stored as span attributes with a special annotation list.
 */
// Track annotations per span (since we can't read attributes back from spans)
const annotationMap = new WeakMap<object, Set<string>>();

export function setXRayAnnotation(key: string, value: string | number | boolean): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  // Set the attribute
  span.setAttribute(key, value);

  // Track annotation keys for this span
  let annotations = annotationMap.get(span);
  if (!annotations) {
    annotations = new Set<string>();
    annotationMap.set(span, annotations);
  }
  
  if (!annotations.has(key)) {
    annotations.add(key);
    // Store annotation list as comma-separated string (X-Ray format)
    span.setAttribute(AWS_ATTRS.XRAY_ANNOTATIONS, [...annotations].join(','));
  }
}

/**
 * Set X-Ray metadata (not indexed)
 *
 * Metadata is not indexed but can be viewed in X-Ray console.
 * It's stored as regular span attributes.
 */
export function setXRayMetadata(key: string, value: string | number | boolean | object): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  if (typeof value === 'object') {
    try {
      span.setAttribute(key, JSON.stringify(value));
    } catch {
      span.setAttribute(key, '<serialization-failed>');
    }
  } else {
    span.setAttribute(key, value);
  }
}
