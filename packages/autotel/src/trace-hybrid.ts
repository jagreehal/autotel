/**
 * Hybrid `trace` export: callable like autotel's `trace(fn)`, AND exposes the
 * full `@opentelemetry/api` `TraceAPI` surface (`trace.getActiveSpan()`,
 * `trace.getTracer()`, …) so existing OTel code "just works" when imported
 * from `autotel`.
 *
 * Implementation: `Object.assign` mutates the autotel `trace` function to
 * attach the OTel TraceAPI methods. Because every reference to `trace` across
 * autotel resolves to the same function instance, this is a one-time, global
 * augmentation.
 */

import { trace as otelTraceApi } from '@opentelemetry/api';
import { trace as autotelTraceFn } from './functional';

const otelMethods = {
  // Class methods on TraceAPI — bind to the singleton.
  setGlobalTracerProvider:
    otelTraceApi.setGlobalTracerProvider.bind(otelTraceApi),
  getTracerProvider: otelTraceApi.getTracerProvider.bind(otelTraceApi),
  getTracer: otelTraceApi.getTracer.bind(otelTraceApi),
  disable: otelTraceApi.disable.bind(otelTraceApi),
  // Instance fields on TraceAPI — already standalone, copy by reference.
  wrapSpanContext: otelTraceApi.wrapSpanContext,
  isSpanContextValid: otelTraceApi.isSpanContextValid,
  deleteSpan: otelTraceApi.deleteSpan,
  getSpan: otelTraceApi.getSpan,
  getActiveSpan: otelTraceApi.getActiveSpan,
  getSpanContext: otelTraceApi.getSpanContext,
  setSpan: otelTraceApi.setSpan,
  setSpanContext: otelTraceApi.setSpanContext,
};

export const trace: typeof autotelTraceFn & typeof otelTraceApi = Object.assign(
  autotelTraceFn,
  otelMethods,
) as typeof autotelTraceFn & typeof otelTraceApi;
