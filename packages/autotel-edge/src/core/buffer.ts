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



export {Buffer} from 'node:buffer';