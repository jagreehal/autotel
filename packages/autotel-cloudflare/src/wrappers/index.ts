/**
 * Wrapper APIs for Cloudflare Workers
 * Provides multiple API styles for maximum flexibility
 */

export { instrument } from './instrument';
export { wrapModule } from './wrap-module';
export { wrapDurableObject } from './wrap-do';
export {
  defineWorkerFetch,
  type DefineWorkerFetchOptions,
  type WorkerFetchHandler,
} from './define-worker-fetch';
