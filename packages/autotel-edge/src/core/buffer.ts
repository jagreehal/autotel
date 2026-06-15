/**
 * Buffer polyfill for edge environments
 *
 * Cloudflare Workers and other edge runtimes need the Buffer global
 * for OpenTelemetry OTLP serialization.
 */

//@ts-ignore - node:buffer available in CF Workers with nodejs_compat
import { Buffer } from 'node:buffer';

//@ts-ignore
globalThis.Buffer = Buffer;

// Re-export the single imported binding. Importing AND re-exporting `Buffer`
// from 'node:buffer' separately makes rolldown (tsdown) emit a dangling
// `Buffer$1` reference, so keep exactly one binding.
export { Buffer };