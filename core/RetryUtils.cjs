/**
 * RetryUtils.cjs - Retry Logic with Exponential Backoff (CommonJS)
 *
 * CRITICAL RELIABILITY: Handles API rate limits (429) and transient failures
 *
 * Based on: research/cline/src/core/api/retry.ts
 * Integrated: January 15, 2026
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_OPTIONS = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  retryAllErrors: false, // Only retry 429 by default
};

// ═══════════════════════════════════════════════════════════════════
// RETRIABLE ERROR CLASS
// ═══════════════════════════════════════════════════════════════════

class RetriableError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = 'RetriableError';
    this.status = 429;
    this.retryAfter = retryAfter;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if error is retryable
 */
function isRetryableError(error) {
  return (
    error instanceof RetriableError ||
    error?.status === 429 ||
    error?.statusCode === 429 ||
    error?.response?.status === 429
  );
}

/**
 * Extract Retry-After header from error
 * Supports multiple header formats
 */
function getRetryAfterValue(error) {
  const headers = error.headers || error.response?.headers || {};

  return (
    headers['retry-after'] ||
    headers['Retry-After'] ||
    headers['x-ratelimit-reset'] ||
    headers['X-RateLimit-Reset'] ||
    headers['ratelimit-reset'] ||
    error.retryAfter
  );
}

/**
 * Calculate delay from Retry-After header
 * Handles both Unix timestamp and delta-seconds formats
 */
function calculateRetryDelay(retryAfter, baseDelay, maxDelay, attempt) {
  if (retryAfter) {
    const retryValue = parseInt(retryAfter, 10);

    if (isNaN(retryValue)) {
      // Invalid value, fall back to exponential backoff
      return Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
    }

    // Check if it's a Unix timestamp (seconds > 1000000000 = ~Sept 2001)
    if (retryValue > 1000000000) {
      // Unix timestamp format
      const delayMs = (retryValue * 1000) - Date.now();
      return Math.max(0, Math.min(maxDelay, delayMs));
    } else {
      // Delta-seconds format
      return Math.min(maxDelay, retryValue * 1000);
    }
  }

  // No header, use exponential backoff: delay = baseDelay * 2^attempt
  return Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════
// RETRY WRAPPER FUNCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Wrap an async function with retry logic
 *
 * @param {Function} fn - The async function to wrap
 * @param {Object} options - Retry configuration
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {boolean} options.retryAllErrors - Retry all errors, not just 429 (default: false)
 * @param {Function} options.onRetryAttempt - Callback(attempt, maxRetries, delay, error)
 * @returns {Function} Wrapped function with retry logic
 *
 * @example
 * const apiCallWithRetry = withRetry(
 *   async () => await fetch('https://api.example.com'),
 *   { maxRetries: 5, baseDelay: 2000 }
 * );
 */
function withRetry(fn, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async function (...args) {
    let lastError;

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      try {
        // Execute the function
        const result = await fn.apply(this, args);
        return result;

      } catch (error) {
        lastError = error;

        const isRateLimitError = isRetryableError(error);
        const isLastAttempt = attempt === config.maxRetries - 1;

        // Don't retry if:
        // 1. Not a rate limit AND we're not retrying all errors
        // 2. This is the last attempt
        if ((!isRateLimitError && !config.retryAllErrors) || isLastAttempt) {
          throw error;
        }

        // Calculate delay
        const retryAfter = getRetryAfterValue(error);
        const delay = calculateRetryDelay(
          retryAfter,
          config.baseDelay,
          config.maxDelay,
          attempt
        );

        // Call retry callback if provided
        if (config.onRetryAttempt) {
          try {
            await config.onRetryAttempt(attempt + 1, config.maxRetries, delay, error);
          } catch (callbackError) {
            console.error('Error in onRetryAttempt callback:', callbackError);
          }
        }

        // Wait before retry
        await sleep(delay);
      }
    }

    // Should never reach here, but just in case
    throw lastError;
  };
}

/**
 * Simple retry wrapper that returns a promise
 *
 * @example
 * try {
 *   const data = await retry(
 *     () => fetch('https://api.example.com'),
 *     { maxRetries: 3 }
 *   );
 * } catch (error) {
 *   console.error('All retries failed:', error);
 * }
 */
async function retry(fn, options = {}) {
  const wrappedFn = withRetry(fn, options);
  return await wrappedFn();
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  withRetry,
  retry,
  RetriableError,
  DEFAULT_OPTIONS,
};
