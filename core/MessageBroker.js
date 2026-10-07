/**
 * core/MessageBroker.js — ESM shim
 *
 * Re-exports the CJS singleton so ESM files can use clean `import` syntax
 * instead of `createRequire` boilerplate.
 *
 * Usage in ESM files:
 *   import messageBroker from '../../core/MessageBroker.js';
 *   import { subscribe, publish } from '../../core/MessageBroker.js';
 *
 * The underlying singleton lives in MessageBroker.cjs and is shared via
 * global.__SOMA_CNS__ — CJS and ESM consumers always use the same broker.
 */
import broker from './MessageBroker.cjs';

export default broker;

// Named re-exports so ESM files can destructure without createRequire boilerplate
export const subscribe          = (...args) => broker.subscribe(...args);
export const unsubscribe        = (...args) => broker.unsubscribe(...args);
export const subscribeByLobe    = (...args) => broker.subscribeByLobe(...args);
export const publish            = (...args) => broker.publish(...args);
export const sendMessage        = (...args) => broker.sendMessage(...args);
export const registerArbiter    = (...args) => broker.registerArbiter(...args);
export const unregisterArbiter  = (...args) => broker.unregisterArbiter(...args);
export const getArbitersByTier  = (...args) => broker.getArbitersByTier(...args);
export const getTierBreakdown   = ()        => broker.getTierBreakdown();
export const getMetrics         = ()        => broker.getMetrics();
