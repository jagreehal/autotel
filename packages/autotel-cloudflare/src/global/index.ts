/**
 * Global instrumentation for Cloudflare Workers
 * Automatically instrument fetch() and cache APIs
 */

export { instrumentGlobalFetch } from './fetch';
export { instrumentGlobalCache } from './cache';
